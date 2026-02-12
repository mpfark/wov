
-- RPC for awarding XP and gold to a party member during combat
-- Leader can grant rewards to any accepted party member
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
DECLARE
  _char RECORD;
  _xp_for_next integer;
  _new_xp integer;
  _new_level integer;
BEGIN
  -- Verify caller is leader of a party containing this character
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm
    JOIN parties p ON p.id = pm.party_id
    WHERE pm.character_id = _character_id
    AND pm.status = 'accepted'
    AND owns_character(p.leader_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = _character_id;
  _new_xp := _char.xp + _xp;
  _xp_for_next := _char.level * 100;

  IF _new_xp >= _xp_for_next THEN
    _new_level := _char.level + 1;
    UPDATE characters SET
      xp = _new_xp - _xp_for_next,
      gold = _char.gold + _gold,
      level = _new_level,
      max_hp = _char.max_hp + 5,
      hp = _char.max_hp + 5,
      unspent_stat_points = _char.unspent_stat_points + 2
    WHERE id = _character_id;
  ELSE
    UPDATE characters SET
      xp = _new_xp,
      gold = _char.gold + _gold
    WHERE id = _character_id;
  END IF;
END;
$$;
