DROP FUNCTION IF EXISTS public.award_party_member(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.award_party_member(
  _character_id uuid,
  _xp integer,
  _gold integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _xp < 0 OR _xp > 1000000 THEN
    RAISE EXCEPTION 'Invalid XP amount';
  END IF;
  IF _gold < 0 OR _gold > 1000000 THEN
    RAISE EXCEPTION 'Invalid gold amount';
  END IF;

  UPDATE characters
  SET xp = xp + _xp,
      gold = gold + _gold
  WHERE id = _character_id;
END;
$$;