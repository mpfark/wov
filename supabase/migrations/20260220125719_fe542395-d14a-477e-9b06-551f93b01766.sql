
-- Add CP columns to characters
ALTER TABLE public.characters
  ADD COLUMN cp integer NOT NULL DEFAULT 100,
  ADD COLUMN max_cp integer NOT NULL DEFAULT 100;

-- Update the restrict_party_leader_updates trigger to protect cp and max_cp
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() = NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF is_steward_or_overlord() THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.name := OLD.name;
  NEW.race := OLD.race;
  NEW.class := OLD.class;
  NEW.level := OLD.level;
  NEW.xp := OLD.xp;
  NEW.hp := OLD.hp;
  NEW.max_hp := OLD.max_hp;
  NEW.gold := OLD.gold;
  NEW.str := OLD.str;
  NEW.dex := OLD.dex;
  NEW.con := OLD.con;
  NEW.int := OLD.int;
  NEW.wis := OLD.wis;
  NEW.cha := OLD.cha;
  NEW.ac := OLD.ac;
  NEW.unspent_stat_points := OLD.unspent_stat_points;
  NEW.user_id := OLD.user_id;
  NEW.cp := OLD.cp;
  NEW.max_cp := OLD.max_cp;
  RETURN NEW;
END;
$function$;

-- Update award_party_member to increase max_cp by 3 on level-up
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
  _base_str integer;
  _base_dex integer;
  _base_con integer;
  _base_int integer;
  _base_wis integer;
  _base_cha integer;
  _new_max_cp integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _character_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
      AND pm2.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
      AND pm1.character_id != pm2.character_id
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM party_members pm
      JOIN parties p ON p.id = pm.party_id
      WHERE pm.character_id = _character_id
        AND pm.status = 'accepted'
        AND owns_character(p.leader_id)
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  SELECT * INTO _char FROM characters WHERE id = _character_id;
  _new_xp := _char.xp + _xp;
  _xp_for_next := _char.level * 100;

  IF _new_xp >= _xp_for_next THEN
    _new_level := _char.level + 1;
    _new_max_cp := _char.max_cp + 3;

    _class_bonus_str := CASE WHEN _char.class = 'warrior' AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_dex := CASE WHEN _char.class IN ('ranger', 'rogue', 'warrior') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_con := CASE WHEN _char.class = 'healer' AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_int := CASE WHEN _char.class IN ('wizard', 'bard') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_wis := CASE WHEN _char.class IN ('wizard', 'ranger', 'healer') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;
    _class_bonus_cha := CASE WHEN _char.class IN ('rogue', 'bard') AND _new_level % 3 = 0 THEN 1 ELSE 0 END;

    IF _new_level < 30 THEN
      _base_str := _char.str + 1;
      _base_dex := _char.dex + 1;
      _base_con := _char.con + 1;
      _base_int := _char.int + 1;
      _base_wis := _char.wis + 1;
      _base_cha := _char.cha + 1;
    ELSE
      _base_str := _char.str;
      _base_dex := _char.dex;
      _base_con := _char.con;
      _base_int := _char.int;
      _base_wis := _char.wis;
      _base_cha := _char.cha;
    END IF;

    UPDATE characters SET
      xp = _new_xp - _xp_for_next,
      gold = _char.gold + _gold,
      level = _new_level,
      max_hp = _char.max_hp + 5,
      hp = _char.max_hp + 5,
      max_cp = _new_max_cp,
      cp = _new_max_cp,
      str = _base_str + _class_bonus_str,
      dex = _base_dex + _class_bonus_dex,
      con = _base_con + _class_bonus_con,
      int = _base_int + _class_bonus_int,
      wis = _base_wis + _class_bonus_wis,
      cha = _base_cha + _class_bonus_cha
    WHERE id = _character_id;
  ELSE
    UPDATE characters SET
      xp = _new_xp,
      gold = _char.gold + _gold
    WHERE id = _character_id;
  END IF;
END;
$function$;
