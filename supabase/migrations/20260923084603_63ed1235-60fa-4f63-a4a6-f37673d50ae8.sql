CREATE OR REPLACE FUNCTION public.enforce_unique_holder_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE unique_item boolean; registered uuid; listing_status text;
BEGIN
  SELECT rarity::text='unique' INTO unique_item FROM public.items WHERE id=NEW.item_id;
  IF TG_TABLE_NAME='marketplace_listings' THEN
    listing_status := to_jsonb(NEW)->>'status';
    IF listing_status IS DISTINCT FROM 'active' AND NEW.unique_instance_id IS NULL THEN RETURN NEW; END IF;
  END IF;
  IF unique_item AND NEW.unique_instance_id IS NULL THEN RAISE EXCEPTION 'unique item requires authoritative instance'; END IF;
  IF NOT unique_item AND NEW.unique_instance_id IS NOT NULL THEN RAISE EXCEPTION 'non-unique item cannot carry unique instance'; END IF;
  IF unique_item THEN
    SELECT item_id INTO registered FROM public.unique_item_instance WHERE id=NEW.unique_instance_id;
    IF registered IS DISTINCT FROM NEW.item_id THEN RAISE EXCEPTION 'unique instance catalogue mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE src text; missing text;
BEGIN
  SELECT p.prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='enforce_unique_holder_identity';
  IF src IS NULL THEN RAISE EXCEPTION 'enforce_unique_holder_identity is not installed'; END IF;
  IF src ~ 'NEW\.status' THEN RAISE EXCEPTION 'installed body still references NEW.status'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='character_inventory' AND column_name='status') THEN
    RAISE EXCEPTION 'unexpected character_inventory.status column: revisit this correction';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='marketplace_listings' AND column_name='status') THEN
    RAISE EXCEPTION 'marketplace_listings.status is missing: revisit this correction';
  END IF;

  SELECT string_agg(t.tgname, ',') INTO missing FROM (
    VALUES ('character_inventory_unique_identity'),('node_ground_loot_unique_identity'),('marketplace_unique_identity')
  ) AS t(tgname)
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname=t.tgname AND NOT g.tgisinternal
                      AND g.tgdeferrable AND g.tginitdeferred AND g.tgenabled='O');
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'expected enabled deferred identity triggers missing: %', missing;
  END IF;
END $$;