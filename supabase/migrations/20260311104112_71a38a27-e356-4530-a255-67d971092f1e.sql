CREATE OR REPLACE FUNCTION public.heal_party_member(_healer_id uuid, _target_id uuid, _heal_amount integer, _effective_max_hp integer DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _target RECORD;
  _restored integer;
  _cap integer;
BEGIN
  IF NOT owns_character(_healer_id) THEN
    RAISE EXCEPTION 'Not authorized: you do not own this character';
  END IF;

  SELECT hp, max_hp INTO _target FROM characters WHERE id = _target_id;
  _cap := COALESCE(_effective_max_hp, _target.max_hp);

  IF _healer_id = _target_id THEN
    _restored := LEAST(_heal_amount, _cap - _target.hp);
    UPDATE characters SET hp = LEAST(hp + _heal_amount, _cap) WHERE id = _target_id;
    RETURN _restored;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _healer_id
      AND pm2.character_id = _target_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
  ) THEN
    RAISE EXCEPTION 'Target is not in your party';
  END IF;

  _restored := LEAST(_heal_amount, _cap - _target.hp);
  UPDATE characters SET hp = LEAST(hp + _heal_amount, _cap) WHERE id = _target_id;
  RETURN _restored;
END;
$$;