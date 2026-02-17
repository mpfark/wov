
CREATE OR REPLACE FUNCTION public.award_party_member(_character_id uuid, _xp integer, _gold integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _xp_for_next integer;
  _new_xp integer;
  _new_level integer;
  _class_bonus_str integer;
  _class_bonus_dex integer;
  _class_bonus_con integer;
  _class_bonus_int integer;
  _class_bonus_wis integer;
  _class_bonus_cha integer;
BEGIN
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

    -- Calculate class bonuses (applied every 3 levels)
    _class_bonus_str := CASE WHEN _char.class = 'warrior' AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_dex := CASE WHEN _char.class IN ('ranger', 'rogue') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_con := CASE WHEN _char.class IN ('warrior', 'healer') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_int := CASE WHEN _char.class IN ('wizard', 'bard') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_wis := CASE WHEN _char.class IN ('wizard', 'ranger', 'healer') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_cha := CASE WHEN _char.class IN ('rogue', 'bard') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;

    UPDATE characters SET
      xp = _new_xp - _xp_for_next,
      gold = _char.gold + _gold,
      level = _new_level,
      max_hp = _char.max_hp + 5,
      hp = _char.max_hp + 5,
      str = LEAST(_char.str + 1 + _class_bonus_str, 30),
      dex = LEAST(_char.dex + 1 + _class_bonus_dex, 30),
      con = LEAST(_char.con + 1 + _class_bonus_con, 30),
      int = LEAST(_char.int + 1 + _class_bonus_int, 30),
      wis = LEAST(_char.wis + 1 + _class_bonus_wis, 30),
      cha = LEAST(_char.cha + 1 + _class_bonus_cha, 30)
    WHERE id = _character_id;
  ELSE
    UPDATE characters SET
      xp = _new_xp,
      gold = _char.gold + _gold
    WHERE id = _character_id;
  END IF;
END;
$function$;
