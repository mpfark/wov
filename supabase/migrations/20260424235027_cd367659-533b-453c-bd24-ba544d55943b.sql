-- Add escrow columns to marketplace_listings
ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS payout_amount integer,
  ADD COLUMN IF NOT EXISTS payout_collected_at timestamptz;

-- Backfill existing sold listings: treat as already collected (under old auto-credit model)
UPDATE public.marketplace_listings
   SET payout_amount = GREATEST(0, floor(price * (1 - tax_rate))::integer),
       payout_collected_at = COALESCE(sold_at, now())
 WHERE status = 'sold'
   AND payout_amount IS NULL;

-- Index for fast "my uncollected sales" lookups
CREATE INDEX IF NOT EXISTS idx_marketplace_uncollected
  ON public.marketplace_listings (seller_character_id)
  WHERE status = 'sold' AND payout_collected_at IS NULL;

-- Modify buy_unique_listing: store payout in escrow instead of crediting seller immediately
CREATE OR REPLACE FUNCTION public.buy_unique_listing(p_character_id uuid, p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT * INTO _node FROM nodes WHERE id = _buyer.current_node_id;
  IF _node IS NULL OR _node.is_marketplace IS NOT TRUE THEN
    RAISE EXCEPTION 'You must be at a marketplace to buy';
  END IF;

  IF _buyer.gold < _listing.price THEN
    RAISE EXCEPTION 'Not enough gold';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || _listing.item_id::text));
  IF EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _listing.item_id) THEN
    RAISE EXCEPTION 'This unique item is already held by another character';
  END IF;

  _payout := GREATEST(0, floor(_listing.price * (1 - _listing.tax_rate))::integer);

  -- Deduct buyer gold (owner path; trigger allows decrease)
  UPDATE characters SET gold = gold - _listing.price WHERE id = p_character_id;

  -- NOTE: seller is NOT credited here. Payout sits in escrow on the listing
  -- until the seller visits a marketplace and calls collect_marketplace_payouts.

  -- Transfer item to buyer with preserved durability
  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _listing.item_id, _listing.current_durability);

  -- Mark sold + escrow the payout
  UPDATE marketplace_listings
    SET status = 'sold',
        buyer_character_id = p_character_id,
        sold_at = now(),
        inventory_item_id = NULL,
        payout_amount = _payout,
        payout_collected_at = NULL
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
$function$;

-- New RPC: collect all uncollected marketplace payouts for caller (must be at a marketplace)
CREATE OR REPLACE FUNCTION public.collect_marketplace_payouts(p_character_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _node RECORD;
  _row RECORD;
  _total integer := 0;
  _count integer := 0;
  _items jsonb := '[]'::jsonb;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;
  IF _char IS NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  SELECT * INTO _node FROM nodes WHERE id = _char.current_node_id;
  IF _node IS NULL OR _node.is_marketplace IS NOT TRUE THEN
    RAISE EXCEPTION 'You must be at a marketplace to collect your earnings';
  END IF;

  FOR _row IN
    SELECT id, payout_amount, item_snapshot
      FROM marketplace_listings
     WHERE seller_character_id = p_character_id
       AND status = 'sold'
       AND payout_collected_at IS NULL
     FOR UPDATE SKIP LOCKED
  LOOP
    _total := _total + COALESCE(_row.payout_amount, 0);
    _count := _count + 1;
    _items := _items || jsonb_build_array(jsonb_build_object(
      'name', _row.item_snapshot->>'name',
      'payout', COALESCE(_row.payout_amount, 0)
    ));
    UPDATE marketplace_listings
       SET payout_collected_at = now()
     WHERE id = _row.id;
  END LOOP;

  IF _total > 0 THEN
    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE characters SET gold = gold + _total WHERE id = p_character_id;
  END IF;

  RETURN jsonb_build_object(
    'collected_count', _count,
    'total_gold', _total,
    'items', _items
  );
END;
$function$;