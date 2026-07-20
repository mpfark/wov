
-- Buff CON → Max HP by 2×. Mirrors src/shared/formulas/resources.ts:getMaxHp.
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

  WITH equipped AS (
    SELECT
      COALESCE(NULLIF(ci.stat_override, '{}'::jsonb), i.stats, '{}'::jsonb) AS base,
      COALESCE(ci.applied_gems, '{}'::jsonb) AS gems
    FROM character_inventory ci
    JOIN items i ON i.id = ci.item_id
    WHERE ci.character_id = p_character_id
      AND ci.equipped_slot IS NOT NULL
      AND ci.current_durability > 0
  )
  SELECT
    COALESCE(SUM(COALESCE((base->>'hp')::int, 0)), 0),
    COALESCE(SUM(
      COALESCE((base->>'con')::int, 0)
      + COALESCE((gems->>'emerald')::int, 0)
    ), 0),
    COALESCE(SUM(
      COALESCE((base->>'wis')::int, 0)
      + COALESCE((gems->>'pearl')::int, 0)
    ), 0),
    COALESCE(SUM(
      COALESCE((base->>'dex')::int, 0)
      + COALESCE((gems->>'topaz')::int, 0)
    ), 0)
  INTO _bonus_hp, _bonus_con, _bonus_wis, _bonus_dex
  FROM equipped;

  _eff_con := _char.con + _bonus_con;
  _eff_wis := _char.wis + _bonus_wis;
  _eff_dex := _char.dex + _bonus_dex;

  _base_hp := CASE _char.class::text
    WHEN 'warrior' THEN 24
    WHEN 'wizard'  THEN 16
    WHEN 'ranger'  THEN 20
    WHEN 'rogue'   THEN 16
    WHEN 'assassin' THEN 16
    WHEN 'healer'  THEN 18
    WHEN 'bard'    THEN 16
    WHEN 'templar' THEN 22
    ELSE 18
  END;

  _con_mod := floor((_eff_con - 10) / 2.0)::int;
  _wis_mod := GREATEST(floor((_eff_wis - 10) / 2.0)::int, 0);
  _dex_mod := GREATEST(floor((_eff_dex - 10) / 2.0)::int, 0);

  -- CON buff: modifier contributes 2× to Max HP (was 1×).
  _new_max_hp := _base_hp + (_con_mod * 2) + (_char.level - 1) * 5 + _bonus_hp;
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

-- One-shot backfill: raise persisted max_hp for every character using the new
-- 2× CON formula. Current hp is left untouched (players don't get free healing).
DO $$
DECLARE
  _id uuid;
  _char RECORD;
  _bonus_hp integer;
  _bonus_con integer;
  _bonus_wis integer;
  _bonus_dex integer;
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
BEGIN
  FOR _id IN SELECT id FROM characters LOOP
    SELECT * INTO _char FROM characters WHERE id = _id;

    WITH equipped AS (
      SELECT
        COALESCE(NULLIF(ci.stat_override, '{}'::jsonb), i.stats, '{}'::jsonb) AS base,
        COALESCE(ci.applied_gems, '{}'::jsonb) AS gems
      FROM character_inventory ci
      JOIN items i ON i.id = ci.item_id
      WHERE ci.character_id = _id
        AND ci.equipped_slot IS NOT NULL
        AND ci.current_durability > 0
    )
    SELECT
      COALESCE(SUM(COALESCE((base->>'hp')::int, 0)), 0),
      COALESCE(SUM(COALESCE((base->>'con')::int, 0) + COALESCE((gems->>'emerald')::int, 0)), 0),
      COALESCE(SUM(COALESCE((base->>'wis')::int, 0) + COALESCE((gems->>'pearl')::int, 0)), 0),
      COALESCE(SUM(COALESCE((base->>'dex')::int, 0) + COALESCE((gems->>'topaz')::int, 0)), 0)
    INTO _bonus_hp, _bonus_con, _bonus_wis, _bonus_dex
    FROM equipped;

    _eff_con := _char.con + COALESCE(_bonus_con, 0);
    _eff_wis := _char.wis + COALESCE(_bonus_wis, 0);
    _eff_dex := _char.dex + COALESCE(_bonus_dex, 0);

    _base_hp := CASE _char.class::text
      WHEN 'warrior' THEN 24
      WHEN 'wizard'  THEN 16
      WHEN 'ranger'  THEN 20
      WHEN 'rogue'   THEN 16
      WHEN 'assassin' THEN 16
      WHEN 'healer'  THEN 18
      WHEN 'bard'    THEN 16
      WHEN 'templar' THEN 22
      ELSE 18
    END;

    _con_mod := floor((_eff_con - 10) / 2.0)::int;
    _wis_mod := GREATEST(floor((_eff_wis - 10) / 2.0)::int, 0);
    _dex_mod := GREATEST(floor((_eff_dex - 10) / 2.0)::int, 0);

    _new_max_hp := LEAST(GREATEST(_base_hp + (_con_mod * 2) + (_char.level - 1) * 5 + COALESCE(_bonus_hp, 0), 1), 10000);
    _new_max_cp := LEAST(GREATEST(30 + (_char.level - 1) * 3 + _wis_mod * 6, 0), 5000);
    _new_max_mp := LEAST(GREATEST(100 + _dex_mod * 10 + floor((_char.level - 1) * 2)::int, 0), 5000);

    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE characters
       SET max_hp = _new_max_hp,
           max_cp = _new_max_cp,
           max_mp = _new_max_mp,
           hp = LEAST(GREATEST(hp, 0), _new_max_hp),
           cp = LEAST(GREATEST(COALESCE(cp, _new_max_cp), 0), _new_max_cp),
           mp = LEAST(GREATEST(COALESCE(mp, _new_max_mp), 0), _new_max_mp)
     WHERE id = _id;
  END LOOP;
END $$;
