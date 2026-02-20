
CREATE OR REPLACE FUNCTION public.damage_party_member(_character_id uuid, _damage integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _new_hp integer;
BEGIN
  -- Verify the caller is in the same party as the target
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _character_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
      AND pm2.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not in the same party';
  END IF;

  -- Atomically subtract damage and return new HP
  UPDATE characters
  SET hp = GREATEST(hp - _damage, 0)
  WHERE id = _character_id
  RETURNING hp INTO _new_hp;

  RETURN _new_hp;
END;
$$;
