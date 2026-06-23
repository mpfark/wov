
CREATE OR REPLACE FUNCTION public.apply_crafting_xp(
  p_character_id uuid,
  p_xp integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c RECORD;
  _new_xp integer;
  _new_level integer;
  _needed integer;
  _leveled boolean := false;
  _str integer; _dex integer; _con integer;
  _int integer; _wis integer; _cha integer;
  _unspent integer;
  _respec integer;
  _bonus_hp integer := 0;
  _bonus_con integer := 0;
  _bonus_wis integer := 0;
  _bonus_dex integer := 0;
  _eff_con integer; _eff_wis integer; _eff_dex integer;
  _con_mod integer; _wis_mod integer; _dex_mod integer;
  _base_hp integer;
  _new_max_hp integer; _new_max_cp integer; _new_max_mp integer;
BEGIN
  IF p_xp IS NULL OR p_xp <= 0 THEN
    RETURN jsonb_build_object('leveled_up', false);
  END IF;

  SELECT * INTO _c FROM characters WHERE id = p_character_id FOR UPDATE;
  IF _c IS NULL THEN
    RAISE EXCEPTION 'Character not found';
  END IF;

  IF _c.level >= 42 THEN
    RETURN jsonb_build_object('leveled_up', false, 'xp', _c.xp, 'level', _c.level);
  END IF;

  _new_xp := COALESCE(_c.xp, 0) + p_xp;
  _new_level := _c.level;
  _needed := floor(power(_c.level, 2.0) * 50)::int;
  _str := _c.str; _dex := _c.dex; _con := _c.con;
  _int := _c.int; _wis := _c.wis; _cha := _c.cha;
  _unspent := COALESCE(_c.unspent_stat_points, 0);
  _respec := COALESCE(_c.respec_points, 0);

  IF _new_xp >= _needed THEN
    _leveled := true;
    _new_level := _c.level + 1;
    _new_xp := _new_xp - _needed;
    _unspent := _unspent + 1;

    IF _new_level % 3 = 0 THEN
      CASE _c.class::text
        WHEN 'warrior' THEN _str := _str + 1; _dex := _dex + 1;
        WHEN 'wizard'  THEN _int := _int + 1; _wis := _wis + 1;
        WHEN 'ranger'  THEN _dex := _dex + 1; _wis := _wis + 1;
        WHEN 'rogue'   THEN _dex := _dex + 1; _cha := _cha + 1;
        WHEN 'healer'  THEN _wis := _wis + 1; _con := _con + 1;
        WHEN 'bard'    THEN _cha := _cha + 1; _int := _int + 1;
        WHEN 'templar' THEN _wis := _wis + 1; _con := _con + 1;
        ELSE NULL;
      END CASE;
    END IF;

    IF _new_level IN (10, 20, 30, 40) THEN
      _respec := _respec + 1;
    END IF;

    IF _new_level = 40 THEN
      PERFORM public.add_material(p_character_id, 'soulmarked_ember', 1);
    END IF;
    IF _new_level = 42 THEN
      PERFORM public.add_material(p_character_id, 'corebound_fragment', 1);
    END IF;

    IF _new_level >= 42 THEN
      _new_xp := 0;
    END IF;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE((i.stats->>'hp')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'con')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'dex')::int, 0)), 0)
  INTO _bonus_hp, _bonus_con, _bonus_wis, _bonus_dex
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = p_character_id
    AND ci.equipped_slot IS NOT NULL
    AND ci.current_durability > 0;

  _eff_con := _con + _bonus_con;
  _eff_wis := _wis + _bonus_wis;
  _eff_dex := _dex + _bonus_dex;

  _base_hp := CASE _c.class::text
    WHEN 'warrior' THEN 24
    WHEN 'wizard'  THEN 16
    WHEN 'ranger'  THEN 20
    WHEN 'rogue'   THEN 16
    WHEN 'healer'  THEN 18
    WHEN 'bard'    THEN 16
    WHEN 'templar' THEN 22
    ELSE 18
  END;

  _con_mod := floor((_eff_con - 10) / 2.0)::int;
  _wis_mod := GREATEST(floor((_eff_wis - 10) / 2.0)::int, 0);
  _dex_mod := GREATEST(floor((_eff_dex - 10) / 2.0)::int, 0);

  _new_max_hp := LEAST(GREATEST(_base_hp + _con_mod + (_new_level - 1) * 5 + _bonus_hp, 1), 10000);
  _new_max_cp := LEAST(GREATEST(30 + (_new_level - 1) * 3 + _wis_mod * 6, 0), 5000);
  _new_max_mp := LEAST(GREATEST(100 + _dex_mod * 10 + floor((_new_level - 1) * 2)::int, 0), 5000);

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters
     SET xp = _new_xp,
         level = _new_level,
         str = _str, dex = _dex, con = _con,
         int = _int, wis = _wis, cha = _cha,
         unspent_stat_points = _unspent,
         respec_points = _respec,
         max_hp = _new_max_hp,
         max_cp = _new_max_cp,
         max_mp = _new_max_mp,
         hp = CASE WHEN _leveled THEN _new_max_hp ELSE LEAST(GREATEST(_c.hp, 0), _new_max_hp) END,
         cp = LEAST(GREATEST(COALESCE(_c.cp, _new_max_cp), 0), _new_max_cp),
         mp = LEAST(GREATEST(COALESCE(_c.mp, _new_max_mp), 0), _new_max_mp)
   WHERE id = p_character_id;

  RETURN jsonb_build_object(
    'leveled_up', _leveled,
    'xp', _new_xp,
    'level', _new_level,
    'new_max_hp', _new_max_hp,
    'new_max_cp', _new_max_cp,
    'new_max_mp', _new_max_mp
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_crafting_xp(uuid, integer) TO service_role;
