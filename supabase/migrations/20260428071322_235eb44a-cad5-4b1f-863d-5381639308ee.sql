-- Unified CP refactor: pool now scales with WIS only (×6).
-- Mirror of getMaxCp(level, wis) in src/shared/formulas/resources.ts.
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
  _bonus_wis integer := 0;
  _bonus_dex integer := 0;
  _eff_con integer;
  _eff_wis integer;
  _eff_dex integer;
  _con_mod integer;
  _wis_mod integer;
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
    COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0),
    COALESCE(SUM(COALESCE((i.stats->>'dex')::int, 0)), 0)
  INTO _bonus_hp, _bonus_con, _bonus_wis, _bonus_dex
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = p_character_id
    AND ci.equipped_slot IS NOT NULL
    AND ci.current_durability > 0;

  _eff_con := _char.con + _bonus_con;
  _eff_wis := _char.wis + _bonus_wis;
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
  _wis_mod := GREATEST(floor((_eff_wis - 10) / 2.0)::int, 0);
  _dex_mod := GREATEST(floor((_eff_dex - 10) / 2.0)::int, 0);

  _new_max_hp := _base_hp + _con_mod + (_char.level - 1) * 5 + _bonus_hp;
  -- WIS-only CP pool (was: 30 + (level-1)*3 + (intMod+wisMod)*3)
  _new_max_cp := 30 + (_char.level - 1) * 3 + _wis_mod * 6;
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

-- One-shot backfill: re-sync every character so max_cp reflects the new WIS-only formula.
-- Bypasses owns_character() by doing the math inline with trusted_rpc flag.
DO $$
DECLARE
  _row RECORD;
  _bonus_hp integer; _bonus_con integer; _bonus_wis integer; _bonus_dex integer;
  _eff_con integer; _eff_wis integer; _eff_dex integer;
  _con_mod integer; _wis_mod integer; _dex_mod integer;
  _base_hp integer;
  _new_max_hp integer; _new_max_cp integer; _new_max_mp integer;
  _new_hp integer; _new_cp integer; _new_mp integer;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  FOR _row IN SELECT * FROM characters LOOP
    SELECT
      COALESCE(SUM(COALESCE((i.stats->>'hp')::int, 0)), 0),
      COALESCE(SUM(COALESCE((i.stats->>'con')::int, 0)), 0),
      COALESCE(SUM(COALESCE((i.stats->>'wis')::int, 0)), 0),
      COALESCE(SUM(COALESCE((i.stats->>'dex')::int, 0)), 0)
    INTO _bonus_hp, _bonus_con, _bonus_wis, _bonus_dex
    FROM character_inventory ci
    JOIN items i ON i.id = ci.item_id
    WHERE ci.character_id = _row.id
      AND ci.equipped_slot IS NOT NULL
      AND ci.current_durability > 0;

    _eff_con := _row.con + _bonus_con;
    _eff_wis := _row.wis + _bonus_wis;
    _eff_dex := _row.dex + _bonus_dex;
    _con_mod := floor((_eff_con - 10) / 2.0)::int;
    _wis_mod := GREATEST(floor((_eff_wis - 10) / 2.0)::int, 0);
    _dex_mod := GREATEST(floor((_eff_dex - 10) / 2.0)::int, 0);
    _base_hp := CASE _row.class::text
      WHEN 'warrior' THEN 24 WHEN 'wizard' THEN 16 WHEN 'ranger' THEN 20
      WHEN 'rogue' THEN 16 WHEN 'healer' THEN 18 WHEN 'bard' THEN 16
      ELSE 18 END;

    _new_max_hp := LEAST(GREATEST(_base_hp + _con_mod + (_row.level - 1) * 5 + _bonus_hp, 1), 10000);
    _new_max_cp := LEAST(GREATEST(30 + (_row.level - 1) * 3 + _wis_mod * 6, 0), 5000);
    _new_max_mp := LEAST(GREATEST(100 + _dex_mod * 10 + floor((_row.level - 1) * 2)::int, 0), 5000);

    _new_hp := LEAST(GREATEST(_row.hp, 0), _new_max_hp);
    _new_cp := LEAST(GREATEST(COALESCE(_row.cp, _new_max_cp), 0), _new_max_cp);
    _new_mp := LEAST(GREATEST(COALESCE(_row.mp, _new_max_mp), 0), _new_max_mp);

    UPDATE characters
       SET max_hp = _new_max_hp, max_cp = _new_max_cp, max_mp = _new_max_mp,
           hp = _new_hp, cp = _new_cp, mp = _new_mp
     WHERE id = _row.id;
  END LOOP;
END $$;