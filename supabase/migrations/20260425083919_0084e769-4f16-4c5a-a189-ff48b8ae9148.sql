CREATE OR REPLACE FUNCTION public.sync_character_resources(p_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _bonus_hp integer := 0;
  _bonus_con integer := 0;
  _bonus_int integer := 0;
  _bonus_wis integer := 0;
  _bonus_cha integer := 0;
  _bonus_dex integer := 0;
  _eff_con integer;
  _eff_int integer;
  _eff_wis integer;
  _eff_cha integer;
  _eff_dex integer;
  _con_mod integer;
  _int_mod integer;
  _wis_mod integer;
  _cha_mod integer;
  _dex_mod integer;
  _base_hp integer;
  _new_max_hp integer;
  _new_max_cp integer;
  _new_max_mp integer;
  _new_hp integer;
  _new_cp integer;
  _new_mp integer;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;
  IF _char IS NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE((i.stats->>'hp')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'con')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'int')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'cha')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'dex')::int, 0)), 0)
  INTO _bonus_hp, _bonus_con, _bonus_int, _bonus_wis, _bonus_cha, _bonus_dex
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = p_character_id
    AND ci.equipped_slot IS NOT NULL
    AND ci.current_durability > 0;

  _eff_con := _char.con + _bonus_con;
  _eff_int := _char.int + _bonus_int;
  _eff_wis := _char.wis + _bonus_wis;
  _eff_cha := _char.cha + _bonus_cha;
  _eff_dex := _char.dex + _bonus_dex;

  _base_hp := CASE _char.class::text
    WHEN 'warrior' THEN 24
    WHEN 'wizard'  THEN 16
    WHEN 'ranger'  THEN 20
    WHEN 'rogue'   THEN 16
    WHEN 'healer'  THEN 18
    WHEN 'bard'    THEN 16
    ELSE 18
  END;

  _con_mod := floor((_eff_con - 10) / 2.0)::int;
  _int_mod := GREATEST(floor((_eff_int - 10) / 2.0)::int, 0);
  _wis_mod := GREATEST(floor((_eff_wis - 10) / 2.0)::int, 0);
  _cha_mod := GREATEST(floor((_eff_cha - 10) / 2.0)::int, 0);
  _dex_mod := GREATEST(floor((_eff_dex - 10) / 2.0)::int, 0);

  _new_max_hp := _base_hp + _con_mod + (_char.level - 1) * 5 + _bonus_hp;
  _new_max_cp := 30 + (_char.level - 1) * 3 + (_int_mod + _wis_mod) * 3;
  _new_max_mp := 100 + _dex_mod * 10 + floor((_char.level - 1) * 2)::int;

  _new_max_hp := LEAST(GREATEST(_new_max_hp, 1), 10000);
  _new_max_cp := LEAST(GREATEST(_new_max_cp, 0), 5000);
  _new_max_mp := LEAST(GREATEST(_new_max_mp, 0), 5000);

  _new_hp := LEAST(GREATEST(_char.hp, 0), _new_max_hp);
  _new_cp := LEAST(GREATEST(COALESCE(_char.cp, _new_max_cp), 0), _new_max_cp);
  _new_mp := LEAST(GREATEST(COALESCE(_char.mp, _new_max_mp), 0), _new_max_mp);

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters
     SET max_hp = _new_max_hp,
         max_cp = _new_max_cp,
         max_mp = _new_max_mp,
         hp = _new_hp,
         cp = _new_cp,
         mp = _new_mp
   WHERE id = p_character_id;

  RETURN jsonb_build_object(
    'max_hp', _new_max_hp,
    'max_cp', _new_max_cp,
    'max_mp', _new_max_mp,
    'hp', _new_hp,
    'cp', _new_cp,
    'mp', _new_mp
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _stat_delta integer;
  _points_delta integer;
  _respec_delta integer;
  _trusted boolean;
BEGIN
  _trusted := coalesce(current_setting('app.trusted_rpc', true), '') = 'true';

  IF auth.uid() = NEW.user_id THEN
    NEW.level := OLD.level;
    NEW.xp := OLD.xp;
    NEW.race := OLD.race;
    NEW.class := OLD.class;
    NEW.user_id := OLD.user_id;

    IF OLD.soulforged_item_created = true THEN
      NEW.soulforged_item_created := true;
    END IF;

    IF NEW.salvage > OLD.salvage AND NOT _trusted THEN
      NEW.salvage := OLD.salvage;
    END IF;

    IF NEW.gold > OLD.gold AND NOT _trusted THEN
      NEW.gold := OLD.gold;
    END IF;

    IF NOT _trusted THEN
      NEW.max_hp := OLD.max_hp;
      NEW.max_cp := OLD.max_cp;
      NEW.max_mp := OLD.max_mp;
      NEW.ac := OLD.ac;
    END IF;

    IF NEW.bhp > OLD.bhp THEN
      NEW.bhp := OLD.bhp;
    END IF;

    IF NEW.respec_points > OLD.respec_points THEN
      NEW.respec_points := OLD.respec_points;
    END IF;

    _stat_delta := (NEW.str - OLD.str) + (NEW.dex - OLD.dex) + (NEW.con - OLD.con)
                 + (NEW.int - OLD.int) + (NEW.wis - OLD.wis) + (NEW.cha - OLD.cha);
    _points_delta := OLD.unspent_stat_points - NEW.unspent_stat_points;
    _respec_delta := OLD.respec_points - NEW.respec_points;

    IF _respec_delta <= 0 THEN
      IF _stat_delta > 0 AND _stat_delta != _points_delta THEN
        NEW.str := OLD.str;
        NEW.dex := OLD.dex;
        NEW.con := OLD.con;
        NEW.int := OLD.int;
        NEW.wis := OLD.wis;
        NEW.cha := OLD.cha;
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
      IF NEW.unspent_stat_points > OLD.unspent_stat_points THEN
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
    END IF;

    NEW.gold := GREATEST(NEW.gold, 0);
    NEW.ac := LEAST(GREATEST(NEW.ac, 1), 100);
    NEW.max_hp := LEAST(GREATEST(NEW.max_hp, 1), 10000);
    NEW.max_cp := LEAST(GREATEST(NEW.max_cp, 0), 5000);
    NEW.max_mp := LEAST(GREATEST(NEW.max_mp, 0), 5000);
    NEW.hp := LEAST(GREATEST(NEW.hp, 0), NEW.max_hp);
    NEW.cp := LEAST(GREATEST(NEW.cp, 0), NEW.max_cp);
    NEW.mp := LEAST(GREATEST(NEW.mp, 0), NEW.max_mp);
    NEW.str := LEAST(GREATEST(NEW.str, 1), 999);
    NEW.dex := LEAST(GREATEST(NEW.dex, 1), 999);
    NEW.con := LEAST(GREATEST(NEW.con, 1), 999);
    NEW.int := LEAST(GREATEST(NEW.int, 1), 999);
    NEW.wis := LEAST(GREATEST(NEW.wis, 1), 999);
    NEW.cha := LEAST(GREATEST(NEW.cha, 1), 999);

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
  NEW.salvage := OLD.salvage;
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
  NEW.bhp := OLD.bhp;
  NEW.bhp_trained := OLD.bhp_trained;
  RETURN NEW;
END;
$function$;