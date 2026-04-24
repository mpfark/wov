-- 1. Default listing duration → 12 hours (only affects new listings)
ALTER TABLE public.marketplace_listings
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '12 hours');

-- 2. expire_marketplace_listings — never return item to seller
CREATE OR REPLACE FUNCTION public.expire_marketplace_listings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _listing RECORD;
  _count integer := 0;
BEGIN
  FOR _listing IN
    SELECT * FROM marketplace_listings
    WHERE status = 'active' AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Item is NOT returned to seller; it simply re-enters the world drop pool
    -- (no inventory row exists for this unique, so try_acquire_unique_item will allow it to drop again)
    UPDATE marketplace_listings SET status = 'expired' WHERE id = _listing.id;
    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$function$;

-- 3. cancel_unique_listing — disabled (always raises)
CREATE OR REPLACE FUNCTION public.cancel_unique_listing(p_character_id uuid, p_listing_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Listings cannot be cancelled. They expire automatically after 12 hours.';
END;
$function$;

-- 4. admin_cancel_listing — never return item to seller
CREATE OR REPLACE FUNCTION public.admin_cancel_listing(p_listing_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _listing RECORD;
BEGIN
  IF NOT is_steward_or_overlord() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _listing FROM marketplace_listings WHERE id = p_listing_id FOR UPDATE;
  IF _listing IS NULL THEN
    RAISE EXCEPTION 'Listing not found';
  END IF;

  -- Force close the listing without returning the item to the seller.
  -- The unique item will become eligible to drop again from creatures.
  UPDATE marketplace_listings SET status = 'cancelled' WHERE id = p_listing_id;
  RETURN true;
END;
$function$;