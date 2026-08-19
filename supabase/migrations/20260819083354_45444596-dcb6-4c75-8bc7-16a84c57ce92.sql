DO $mig$
DECLARE
  v_def text;
  v_old text := E'        ''bossCast'', cr.boss_cast,';
  v_new text := E'        ''bossCast'', cr.boss_cast,\n        -- Presentation-only boss flavor (crit prose pool + death cry). Never read\n        -- by the simulation; carried so the client can narrate the blow.\n        ''bossCritFlavors'', COALESCE(cr.boss_crit_flavors, ''[]''::jsonb),\n        ''bossDeathCry'', COALESCE(cr.boss_death_cry, ''''),';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'encounter_snapshot_v2'
    AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'encounter_snapshot_v2 not found';
  END IF;

  IF position('bossCritFlavors' in v_def) > 0 THEN
    RAISE NOTICE 'boss flavor already present in snapshot';
    RETURN;
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'snapshot anchor for bossCast not found';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$mig$;