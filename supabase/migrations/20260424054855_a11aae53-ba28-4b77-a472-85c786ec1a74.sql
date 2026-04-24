-- 1. Add is_marketplace column to nodes
ALTER TABLE public.nodes
  ADD COLUMN IF NOT EXISTS is_marketplace boolean NOT NULL DEFAULT false;

-- 2. Marketplace listings table
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_character_id uuid NOT NULL,
  inventory_item_id uuid,
  item_id uuid NOT NULL,
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_durability integer NOT NULL DEFAULT 100,
  price integer NOT NULL CHECK (price > 0),
  tax_rate numeric NOT NULL DEFAULT 0.10,
  tax_amount integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled','expired')),
  buyer_character_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  sold_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_marketplace_listings_status ON public.marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_seller ON public.marketplace_listings(seller_character_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_expires ON public.marketplace_listings(expires_at) WHERE status = 'active';

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view listings"
  ON public.marketplace_listings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can update listings"
  ON public.marketplace_listings FOR UPDATE
  USING (is_steward_or_overlord());

CREATE POLICY "Admins can delete listings"
  ON public.marketplace_listings FOR DELETE
  USING (is_steward_or_overlord());

-- Service role full access (edge functions / RPCs run as definer so this isn't strictly required)
CREATE POLICY "Service role full access on marketplace_listings"
  ON public.marketplace_listings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. RPC: list a unique item
CREATE OR REPLACE FUNCTION public.list_unique_item(
  p_character_id uuid,
  p_inventory_id uuid,
  p_price integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv RECORD;
  _item RECORD;
  _listing_id uuid;
  _tax_rate numeric := 0.10;
  _tax_amount integer;
  _seller_name text;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_price IS NULL OR p_price <= 0 OR p_price > 10000000 THEN
    RAISE EXCEPTION 'Invalid price';
  END IF;

  SELECT ci.id AS inv_id, ci.character_id, ci.equipped_slot, ci.current_durability, ci.item_id
  INTO _inv
  FROM character_inventory ci
  WHERE ci.id = p_inventory_id AND ci.character_id = p_character_id;

  IF _inv IS NULL THEN
    RAISE EXCEPTION 'Item not found in your inventory';
  END IF;

  IF _inv.equipped_slot IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot list equipped items';
  END IF;

  SELECT id, name, rarity::text AS rarity, slot::text AS slot, stats, value, hands,
         illustration_url, item_type, is_soulbound, level, max_durability, procs, weapon_tag
  INTO _item
  FROM items WHERE id = _inv.item_id;

  IF _item IS NULL THEN
    RAISE EXCEPTION 'Item template missing';
  END IF;

  IF _item.rarity <> 'unique' THEN
    RAISE EXCEPTION 'Only unique items can be listed';
  END IF;

  IF _item.is_soulbound THEN
    RAISE EXCEPTION 'Cannot list soulbound items';
  END IF;

  _tax_amount := floor(p_price * _tax_rate)::integer;

  -- Escrow: remove from inventory
  DELETE FROM character_inventory WHERE id = _inv.inv_id;

  INSERT INTO marketplace_listings (
    seller_character_id, inventory_item_id, item_id, item_snapshot,
    current_durability, price, tax_rate, tax_amount, status
  ) VALUES (
    p_character_id, _inv.inv_id, _item.id,
    jsonb_build_object(
      'name', _item.name,
      'rarity', _item.rarity,
      'slot', _item.slot,
      'stats', _item.stats,
      'value', _item.value,
      'hands', _item.hands,
      'illustration_url', _item.illustration_url,
      'item_type', _item.item_type,
      'level', _item.level,
      'max_durability', _item.max_durability,
      'procs', _item.procs,
      'weapon_tag', _item.weapon_tag
    ),
    _inv.current_durability, p_price, _tax_rate, _tax_amount, 'active'
  ) RETURNING id INTO _listing_id;

  SELECT name INTO _seller_name FROM characters WHERE id = p_character_id;

  RETURN jsonb_build_object(
    'listing_id', _listing_id,
    'seller_name', _seller_name,
    'item_name', _item.name,
    'price', p_price
  );
END;
$$;

-- 4. RPC: buy a unique listing
CREATE OR REPLACE FUNCTION public.buy_unique_listing(
  p_character_id uuid,
  p_listing_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _listing RECORD;
  _buyer RECORD;
  _node RECORD;
  _payout integer;
  _seller_name text;
  _buyer_name text;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _listing FROM marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF _listing IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF _listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is no longer active';
  END IF;

  IF _listing.expires_at < now() THEN
    RAISE EXCEPTION 'Listing has expired';
  END IF;

  IF _listing.seller_character_id = p_character_id THEN
    RAISE EXCEPTION 'You cannot buy your own listing';
  END IF;

  SELECT * INTO _buyer FROM characters WHERE id = p_character_id;
  IF _buyer IS NULL THEN
    RAISE EXCEPTION 'Buyer character not found';
  END IF;

  -- Verify buyer is at a marketplace node
  SELECT * INTO _node FROM nodes WHERE id = _buyer.current_node_id;
  IF _node IS NULL OR _node.is_marketplace IS NOT TRUE THEN
    RAISE EXCEPTION 'You must be at a marketplace to buy';
  END IF;

  IF _buyer.gold < _listing.price THEN
    RAISE EXCEPTION 'Not enough gold';
  END IF;

  -- Unique exclusivity sanity check
  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || _listing.item_id::text));
  IF EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _listing.item_id) THEN
    RAISE EXCEPTION 'This unique item is already held by another character';
  END IF;

  _payout := GREATEST(0, floor(_listing.price * (1 - _listing.tax_rate))::integer);

  -- Deduct buyer gold (owner path; trigger allows decrease)
  UPDATE characters SET gold = gold - _listing.price WHERE id = p_character_id;

  -- Pay seller via trusted RPC bypass
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters SET gold = gold + _payout WHERE id = _listing.seller_character_id;

  -- Transfer item to buyer with preserved durability
  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _listing.item_id, _listing.current_durability);

  -- Mark sold
  UPDATE marketplace_listings
    SET status = 'sold',
        buyer_character_id = p_character_id,
        sold_at = now(),
        inventory_item_id = NULL
    WHERE id = p_listing_id;

  SELECT name INTO _seller_name FROM characters WHERE id = _listing.seller_character_id;
  SELECT name INTO _buyer_name FROM characters WHERE id = p_character_id;

  RETURN jsonb_build_object(
    'listing_id', p_listing_id,
    'item_name', _listing.item_snapshot->>'name',
    'price', _listing.price,
    'payout', _payout,
    'seller_name', _seller_name,
    'buyer_name', _buyer_name
  );
END;
$$;

-- 5. RPC: cancel a listing (seller)
CREATE OR REPLACE FUNCTION public.cancel_unique_listing(
  p_character_id uuid,
  p_listing_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _listing RECORD;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _listing FROM marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF _listing IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF _listing.seller_character_id <> p_character_id THEN
    RAISE EXCEPTION 'Not your listing';
  END IF;

  IF _listing.status <> 'active' THEN
    RAISE EXCEPTION 'Listing is not active';
  END IF;

  -- Sanity check: don't restore if someone else now has the item (shouldn't happen)
  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || _listing.item_id::text));
  IF EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _listing.item_id) THEN
    UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
    RETURN false;
  END IF;

  -- Return item to seller
  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _listing.item_id, _listing.current_durability);

  UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
  RETURN true;
END;
$$;

-- 6. RPC: expire listings (called periodically)
CREATE OR REPLACE FUNCTION public.expire_marketplace_listings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _listing RECORD;
  _count integer := 0;
  _seller_exists boolean;
BEGIN
  FOR _listing IN
    SELECT * FROM marketplace_listings
    WHERE status = 'active' AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT EXISTS(SELECT 1 FROM characters WHERE id = _listing.seller_character_id) INTO _seller_exists;

    -- Sanity: only return if no one else has the unique
    IF _seller_exists AND NOT EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _listing.item_id) THEN
      INSERT INTO character_inventory (character_id, item_id, current_durability)
      VALUES (_listing.seller_character_id, _listing.item_id, _listing.current_durability);
    END IF;

    UPDATE marketplace_listings SET status = 'expired' WHERE id = _listing.id;
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

-- 7. RPC: admin cancel
CREATE OR REPLACE FUNCTION public.admin_cancel_listing(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _listing RECORD;
  _seller_exists boolean;
BEGIN
  IF NOT is_steward_or_overlord() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _listing FROM marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF _listing IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  IF _listing.status <> 'active' THEN
    UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
    RETURN true;
  END IF;

  SELECT EXISTS(SELECT 1 FROM characters WHERE id = _listing.seller_character_id) INTO _seller_exists;

  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || _listing.item_id::text));
  IF _seller_exists AND NOT EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _listing.item_id) THEN
    INSERT INTO character_inventory (character_id, item_id, current_durability)
    VALUES (_listing.seller_character_id, _listing.item_id, _listing.current_durability);
  END IF;

  UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
  RETURN true;
END;
$$;