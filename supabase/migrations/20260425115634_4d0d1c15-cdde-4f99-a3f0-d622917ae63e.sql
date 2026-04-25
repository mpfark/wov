-- Add BHP to award_party_member so combat-catchup can grant boss-hunter-points
-- in the same call as XP/gold/salvage. Older overloads (3-arg, 4-arg) are kept
-- for backwards compatibility with any in-flight deployments.

CREATE OR REPLACE FUNCTION public.award_party_member(
  _character_id uuid,
  _xp integer,
  _gold integer,
  _salvage integer DEFAULT 0,
  _bhp integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _xp < 0 OR _xp > 1000000 THEN
    RAISE EXCEPTION 'Invalid XP amount';
  END IF;
  IF _gold < 0 OR _gold > 1000000 THEN
    RAISE EXCEPTION 'Invalid gold amount';
  END IF;
  IF _salvage < 0 OR _salvage > 1000000 THEN
    RAISE EXCEPTION 'Invalid salvage amount';
  END IF;
  IF _bhp < 0 OR _bhp > 1000000 THEN
    RAISE EXCEPTION 'Invalid BHP amount';
  END IF;

  UPDATE characters
  SET xp = xp + _xp,
      gold = gold + _gold,
      salvage = salvage + _salvage,
      bhp = bhp + _bhp
  WHERE id = _character_id;
END;
$function$;
