-- ADM-025A: global unique physical-item identity.
-- This migration is intentionally fail-closed: run the documented aggregate
-- preflight before installation. No ambiguous live configuration is repaired.

-- Fail closed on vendor rows that could mint a global unique.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vendor_inventory vi JOIN public.items i ON i.id=vi.item_id
    WHERE i.rarity::text='unique'
  ) THEN RAISE EXCEPTION 'ADM-025 preflight: vendor_inventory contains unique catalogue items'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reject_unique_vendor_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.items i WHERE i.id=NEW.item_id AND i.rarity::text='unique') THEN
    RAISE EXCEPTION 'unique items are not valid vendor stock';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_unique_catalogue_rarity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.rarity IS DISTINCT FROM NEW.rarity THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('unique-item:'||OLD.id::text,0));
    IF NEW.rarity::text='unique' AND (
      EXISTS(SELECT 1 FROM public.character_inventory WHERE item_id=OLD.id) OR
      EXISTS(SELECT 1 FROM public.node_ground_loot WHERE item_id=OLD.id) OR
      EXISTS(SELECT 1 FROM public.marketplace_listings WHERE item_id=OLD.id AND status='active') OR
      EXISTS(SELECT 1 FROM public.vendor_inventory WHERE item_id=OLD.id)
    ) THEN RAISE EXCEPTION 'cannot mark a stocked or physical item unique'; END IF;
    IF OLD.rarity::text='unique' AND EXISTS(SELECT 1 FROM public.unique_item_instance WHERE item_id=OLD.id)
    THEN RAISE EXCEPTION 'cannot change rarity while a unique physical instance exists'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER items_guard_unique_rarity BEFORE UPDATE OF rarity ON public.items
FOR EACH ROW EXECUTE FUNCTION public.guard_unique_catalogue_rarity();
DROP TRIGGER IF EXISTS vendor_inventory_reject_unique ON public.vendor_inventory;
CREATE TRIGGER vendor_inventory_reject_unique BEFORE INSERT OR UPDATE OF item_id ON public.vendor_inventory
FOR EACH ROW EXECUTE FUNCTION public.reject_unique_vendor_stock();

CREATE TABLE public.unique_item_instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL UNIQUE REFERENCES public.items(id) ON DELETE RESTRICT,
  location_kind text NOT NULL CHECK(location_kind IN ('inventory','ground','marketplace','transit')),
  location_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.unique_item_instance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unique_item_instance FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.unique_item_instance TO service_role;
REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.unique_item_instance FROM service_role;

ALTER TABLE public.character_inventory ADD COLUMN unique_instance_id uuid UNIQUE;
ALTER TABLE public.node_ground_loot ADD COLUMN unique_instance_id uuid UNIQUE;
ALTER TABLE public.marketplace_listings ADD COLUMN unique_instance_id uuid UNIQUE;

-- Existing physical copies must be unambiguous. Active marketplace rows are
-- physical escrow; historical sold/expired/cancelled rows are not.
DO $$ DECLARE bad integer; BEGIN
  WITH physical AS (
    SELECT ci.item_id,ci.id,'inventory' k FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id WHERE i.rarity::text='unique'
    UNION ALL SELECT gl.item_id,gl.id,'ground' FROM public.node_ground_loot gl JOIN public.items i ON i.id=gl.item_id WHERE i.rarity::text='unique'
    UNION ALL SELECT ml.item_id,ml.id,'marketplace' FROM public.marketplace_listings ml JOIN public.items i ON i.id=ml.item_id WHERE i.rarity::text='unique' AND ml.status='active'
  ) SELECT count(*) INTO bad FROM (SELECT item_id FROM physical GROUP BY item_id HAVING count(*)>1) d;
  IF bad>0 THEN RAISE EXCEPTION 'ADM-025 preflight: duplicate or ambiguous unique physical copies (%)',bad; END IF;
END $$;

DO $$ DECLARE r record; iid uuid; BEGIN
  FOR r IN
    SELECT ci.item_id,ci.id location_id,'inventory' location_kind FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id WHERE i.rarity::text='unique'
    UNION ALL SELECT gl.item_id,gl.id,'ground' FROM public.node_ground_loot gl JOIN public.items i ON i.id=gl.item_id WHERE i.rarity::text='unique'
    UNION ALL SELECT ml.item_id,ml.id,'marketplace' FROM public.marketplace_listings ml JOIN public.items i ON i.id=ml.item_id WHERE i.rarity::text='unique' AND ml.status='active'
  LOOP
    INSERT INTO public.unique_item_instance(item_id,location_kind,location_id)
      VALUES(r.item_id,r.location_kind,r.location_id) RETURNING id INTO iid;
    IF r.location_kind='inventory' THEN UPDATE public.character_inventory SET unique_instance_id=iid WHERE id=r.location_id;
    ELSIF r.location_kind='ground' THEN UPDATE public.node_ground_loot SET unique_instance_id=iid WHERE id=r.location_id;
    ELSE UPDATE public.marketplace_listings SET unique_instance_id=iid WHERE id=r.location_id; END IF;
  END LOOP;
END $$;

ALTER TABLE public.character_inventory ADD CONSTRAINT character_inventory_unique_instance_fk
  FOREIGN KEY(unique_instance_id) REFERENCES public.unique_item_instance(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.node_ground_loot ADD CONSTRAINT node_ground_loot_unique_instance_fk
  FOREIGN KEY(unique_instance_id) REFERENCES public.unique_item_instance(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.marketplace_listings ADD CONSTRAINT marketplace_unique_instance_fk
  FOREIGN KEY(unique_instance_id) REFERENCES public.unique_item_instance(id) DEFERRABLE INITIALLY DEFERRED;

-- Catalogue rarity and durable identity must agree on every real holder.
CREATE OR REPLACE FUNCTION public.enforce_unique_holder_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE unique_item boolean; registered uuid;
BEGIN
  SELECT rarity::text='unique' INTO unique_item FROM public.items WHERE id=NEW.item_id;
  IF TG_TABLE_NAME='marketplace_listings' AND NEW.status<>'active' AND NEW.unique_instance_id IS NULL THEN RETURN NEW; END IF;
  IF unique_item AND NEW.unique_instance_id IS NULL THEN RAISE EXCEPTION 'unique item requires authoritative instance'; END IF;
  IF NOT unique_item AND NEW.unique_instance_id IS NOT NULL THEN RAISE EXCEPTION 'non-unique item cannot carry unique instance'; END IF;
  IF unique_item THEN
    SELECT item_id INTO registered FROM public.unique_item_instance WHERE id=NEW.unique_instance_id;
    IF registered IS DISTINCT FROM NEW.item_id THEN RAISE EXCEPTION 'unique instance catalogue mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER character_inventory_unique_identity AFTER INSERT OR UPDATE ON public.character_inventory
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_holder_identity();
CREATE CONSTRAINT TRIGGER node_ground_loot_unique_identity AFTER INSERT OR UPDATE ON public.node_ground_loot
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_holder_identity();
CREATE CONSTRAINT TRIGGER marketplace_unique_identity AFTER INSERT OR UPDATE ON public.marketplace_listings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_holder_identity();

-- Shared lock order: catalogue item advisory lock, registry row, then holder row.
-- Deletion first moves the immutable instance into transaction-local transit;
-- the next holder insert adopts it. A deferred check destroys an instance that
-- remains in transit at commit (consume, breakage, expiry, cleanup, deletion).
CREATE OR REPLACE FUNCTION public.unique_holder_before_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE is_unique boolean; inst public.unique_item_instance; kind text;
BEGIN
  SELECT rarity::text='unique' INTO is_unique FROM public.items WHERE id=NEW.item_id;
  IF NOT COALESCE(is_unique,false) THEN
    IF NEW.unique_instance_id IS NOT NULL THEN RAISE EXCEPTION 'non-unique item cannot carry unique instance'; END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('unique-item:'||NEW.item_id::text,0));
  kind:=CASE TG_TABLE_NAME WHEN 'character_inventory' THEN 'inventory' WHEN 'node_ground_loot' THEN 'ground' ELSE 'marketplace' END;
  IF NEW.unique_instance_id IS NULL THEN
    SELECT * INTO inst FROM public.unique_item_instance WHERE item_id=NEW.item_id FOR UPDATE;
    IF FOUND AND inst.location_kind<>'transit' THEN RAISE EXCEPTION 'unique item already exists'; END IF;
    IF FOUND THEN NEW.unique_instance_id:=inst.id;
    ELSE
      NEW.unique_instance_id:=gen_random_uuid();
      INSERT INTO public.unique_item_instance(id,item_id,location_kind,location_id)
      VALUES(NEW.unique_instance_id,NEW.item_id,kind,NEW.id);
    END IF;
  ELSE
    SELECT * INTO inst FROM public.unique_item_instance WHERE id=NEW.unique_instance_id FOR UPDATE;
    IF NOT FOUND OR inst.item_id<>NEW.item_id OR inst.location_kind<>'transit' THEN RAISE EXCEPTION 'invalid unique transfer'; END IF;
  END IF;
  UPDATE public.unique_item_instance SET location_kind=kind,location_id=NEW.id,updated_at=clock_timestamp()
  WHERE id=NEW.unique_instance_id;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.unique_holder_before_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.unique_instance_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('unique-item:'||OLD.item_id::text,0));
    UPDATE public.unique_item_instance SET location_kind='transit',location_id=id,updated_at=clock_timestamp()
      WHERE id=OLD.unique_instance_id;
  END IF;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.unique_holder_finalize_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.unique_instance_id IS NOT NULL THEN
    DELETE FROM public.unique_item_instance WHERE id=OLD.unique_instance_id AND location_kind='transit';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.unique_marketplace_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF OLD.status='active' AND NEW.status<>'active' AND OLD.unique_instance_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('unique-item:'||OLD.item_id::text,0));
    UPDATE public.unique_item_instance SET location_kind='transit',location_id=id,updated_at=clock_timestamp()
      WHERE id=OLD.unique_instance_id;
    NEW.unique_instance_id:=NULL;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.reject_unique_vendor_stock() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guard_unique_catalogue_rarity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enforce_unique_holder_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.unique_holder_before_write() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.unique_holder_before_delete() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.unique_holder_finalize_delete() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.unique_marketplace_status() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER character_inventory_unique_write BEFORE INSERT OR UPDATE OF item_id,unique_instance_id ON public.character_inventory FOR EACH ROW EXECUTE FUNCTION public.unique_holder_before_write();
CREATE TRIGGER ground_loot_unique_write BEFORE INSERT OR UPDATE OF item_id,unique_instance_id ON public.node_ground_loot FOR EACH ROW EXECUTE FUNCTION public.unique_holder_before_write();
CREATE TRIGGER marketplace_unique_write BEFORE INSERT OR UPDATE OF item_id,unique_instance_id ON public.marketplace_listings FOR EACH ROW WHEN (NEW.status='active') EXECUTE FUNCTION public.unique_holder_before_write();
CREATE TRIGGER character_inventory_unique_delete BEFORE DELETE ON public.character_inventory FOR EACH ROW EXECUTE FUNCTION public.unique_holder_before_delete();
CREATE TRIGGER ground_loot_unique_delete BEFORE DELETE ON public.node_ground_loot FOR EACH ROW EXECUTE FUNCTION public.unique_holder_before_delete();
CREATE TRIGGER marketplace_unique_delete BEFORE DELETE ON public.marketplace_listings FOR EACH ROW EXECUTE FUNCTION public.unique_holder_before_delete();
CREATE TRIGGER marketplace_unique_status BEFORE UPDATE OF status ON public.marketplace_listings FOR EACH ROW EXECUTE FUNCTION public.unique_marketplace_status();
CREATE CONSTRAINT TRIGGER character_inventory_unique_finalize AFTER DELETE ON public.character_inventory DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.unique_holder_finalize_delete();
CREATE CONSTRAINT TRIGGER ground_loot_unique_finalize AFTER DELETE ON public.node_ground_loot DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.unique_holder_finalize_delete();
CREATE CONSTRAINT TRIGGER marketplace_unique_delete_finalize AFTER DELETE ON public.marketplace_listings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.unique_holder_finalize_delete();
CREATE CONSTRAINT TRIGGER marketplace_unique_finalize AFTER UPDATE OF status ON public.marketplace_listings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.unique_holder_finalize_delete();

-- Marketplace purchase is the one historical transfer that inserted the new
-- holder before releasing escrow. Reorder those two writes and carry identity.
CREATE OR REPLACE FUNCTION public.buy_unique_listing(p_character_id uuid,p_listing_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE l public.marketplace_listings; buyer public.characters; payout integer; seller_name text; buyer_name text; iid uuid;
BEGIN
  IF NOT public.owns_character(p_character_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO l FROM public.marketplace_listings WHERE id=p_listing_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF l.status<>'active' OR l.expires_at<clock_timestamp() THEN RAISE EXCEPTION 'Listing is no longer active'; END IF;
  IF l.seller_character_id=p_character_id THEN RAISE EXCEPTION 'You cannot buy your own listing'; END IF;
  SELECT * INTO buyer FROM public.characters WHERE id=p_character_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Buyer character not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=buyer.current_node_id AND is_marketplace) THEN RAISE EXCEPTION 'You must be at a marketplace to buy'; END IF;
  IF buyer.gold<l.price THEN RAISE EXCEPTION 'Not enough gold'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('unique-item:'||l.item_id::text,0));
  iid:=l.unique_instance_id;
  IF iid IS NULL THEN RAISE EXCEPTION 'Listing has no authoritative unique instance'; END IF;
  payout:=GREATEST(0,floor(l.price*(1-l.tax_rate))::integer);
  UPDATE public.characters SET gold=gold-l.price WHERE id=p_character_id;
  UPDATE public.marketplace_listings SET status='sold',buyer_character_id=p_character_id,sold_at=clock_timestamp(),
    inventory_item_id=NULL,payout_amount=payout,payout_collected_at=NULL WHERE id=l.id;
  INSERT INTO public.character_inventory(character_id,item_id,current_durability,unique_instance_id)
    VALUES(p_character_id,l.item_id,l.current_durability,iid);
  SELECT name INTO seller_name FROM public.characters WHERE id=l.seller_character_id;
  SELECT name INTO buyer_name FROM public.characters WHERE id=p_character_id;
  RETURN jsonb_build_object('listing_id',l.id,'item_name',l.item_snapshot->>'name','price',l.price,
    'payout',payout,'seller_name',seller_name,'buyer_name',buyer_name);
END $$;
REVOKE ALL ON FUNCTION public.buy_unique_listing(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.buy_unique_listing(uuid,uuid) TO authenticated;
