
-- Migrate existing characters to new stat formula
DO $$
DECLARE
  _char RECORD;
  _race_bonuses jsonb;
  _class_bonuses jsonb;
  _level_bonuses jsonb;
  _stat text;
  _stats text[] := ARRAY['str', 'dex', 'con', 'int', 'wis', 'cha'];
  _new_val integer;
  _old_expected integer;
  _manual_points integer;
  _total_manual integer;
  _new_stats jsonb;
  _new_con integer;
  _new_dex integer;
  _base_hp integer;
  _new_max_hp integer;
  _race_key text;
  _class_key text;
BEGIN
  _race_bonuses := '{
    "human":    {"str":1,"dex":1,"con":1,"int":1,"wis":1,"cha":1},
    "elf":      {"str":0,"dex":2,"con":0,"int":1,"wis":1,"cha":0},
    "dwarf":    {"str":2,"dex":0,"con":2,"int":0,"wis":1,"cha":-1},
    "halfling": {"str":-1,"dex":2,"con":1,"int":0,"wis":1,"cha":1},
    "edain":    {"str":1,"dex":0,"con":2,"int":1,"wis":1,"cha":1},
    "half_elf": {"str":0,"dex":1,"con":0,"int":1,"wis":1,"cha":2}
  }'::jsonb;

  _class_bonuses := '{
    "warrior": {"str":3,"dex":1,"con":2,"int":0,"wis":0,"cha":0},
    "wizard":  {"str":0,"dex":0,"con":0,"int":3,"wis":2,"cha":1},
    "ranger":  {"str":1,"dex":3,"con":1,"int":0,"wis":2,"cha":0},
    "rogue":   {"str":0,"dex":3,"con":0,"int":1,"wis":0,"cha":2},
    "healer":  {"str":0,"dex":0,"con":1,"int":1,"wis":3,"cha":2},
    "bard":    {"str":0,"dex":1,"con":0,"int":1,"wis":1,"cha":3}
  }'::jsonb;

  _level_bonuses := '{
    "warrior": {"str":1,"dex":1},
    "wizard":  {"int":1,"wis":1},
    "ranger":  {"dex":1,"wis":1},
    "rogue":   {"dex":1,"cha":1},
    "healer":  {"wis":1,"con":1},
    "bard":    {"cha":1,"int":1}
  }'::jsonb;

  FOR _char IN SELECT * FROM characters LOOP
    _race_key := _char.race::text;
    _class_key := _char.class::text;
    _new_stats := '{}'::jsonb;
    _total_manual := 0;

    FOREACH _stat IN ARRAY _stats LOOP
      _old_expected := 8
        + COALESCE((_race_bonuses -> _race_key ->> _stat)::int, 0)
        + COALESCE((_class_bonuses -> _class_key ->> _stat)::int, 0)
        + GREATEST(0, LEAST(_char.level, 29) - 1);

      FOR i IN 1.._char.level LOOP
        IF i % 3 = 0 THEN
          _old_expected := _old_expected + COALESCE((_level_bonuses -> _class_key ->> _stat)::int, 0);
        END IF;
      END LOOP;

      _manual_points := GREATEST(0, 
        CASE _stat
          WHEN 'str' THEN _char.str
          WHEN 'dex' THEN _char.dex
          WHEN 'con' THEN _char.con
          WHEN 'int' THEN _char.int
          WHEN 'wis' THEN _char.wis
          WHEN 'cha' THEN _char.cha
        END - _old_expected
      );
      _total_manual := _total_manual + _manual_points;

      _new_val := 8
        + COALESCE((_race_bonuses -> _race_key ->> _stat)::int, 0)
        + COALESCE((_class_bonuses -> _class_key ->> _stat)::int, 0)
        + FLOOR(_char.level / 5);

      FOR i IN 1.._char.level LOOP
        IF i % 3 = 0 THEN
          _new_val := _new_val + COALESCE((_level_bonuses -> _class_key ->> _stat)::int, 0);
        END IF;
      END LOOP;

      _new_stats := _new_stats || jsonb_build_object(_stat, _new_val);
    END LOOP;

    _new_con := (_new_stats ->> 'con')::int;
    _new_dex := (_new_stats ->> 'dex')::int;

    _base_hp := CASE _class_key
      WHEN 'warrior' THEN 24
      WHEN 'wizard' THEN 16
      WHEN 'ranger' THEN 20
      WHEN 'rogue' THEN 16
      WHEN 'healer' THEN 18
      WHEN 'bard' THEN 16
      ELSE 18
    END;
    _new_max_hp := _base_hp + FLOOR((_new_con - 10) / 2) + (_char.level - 1) * 5;

    UPDATE characters SET
      str = (_new_stats ->> 'str')::int,
      dex = (_new_stats ->> 'dex')::int,
      con = (_new_stats ->> 'con')::int,
      int = (_new_stats ->> 'int')::int,
      wis = (_new_stats ->> 'wis')::int,
      cha = (_new_stats ->> 'cha')::int,
      unspent_stat_points = _char.unspent_stat_points + _total_manual,
      max_hp = _new_max_hp,
      hp = LEAST(_char.hp, _new_max_hp),
      ac = CASE _class_key
        WHEN 'warrior' THEN 14
        WHEN 'ranger' THEN 12
        WHEN 'rogue' THEN 12
        ELSE 11
      END + FLOOR((_new_dex - 10) / 2)
    WHERE id = _char.id;
  END LOOP;
END $$;
