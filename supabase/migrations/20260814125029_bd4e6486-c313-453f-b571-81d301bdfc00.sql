DO $do$
DECLARE
  def text;
  patched text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'encounter_snapshot_v2';

  IF def IS NULL THEN
    RAISE EXCEPTION 'encounter_snapshot_v2 not found';
  END IF;

  patched := replace(
    def,
    $old$'attrs', cr.stats,$old$,
    $new$'attrs', jsonb_build_object('str', 10, 'dex', 10, 'con', 10, 'int', 10, 'wis', 10, 'cha', 10) || COALESCE(cr.stats, '{}'::jsonb),$new$
  );

  IF patched = def THEN
    RAISE EXCEPTION 'creature attrs projection not found in encounter_snapshot_v2';
  END IF;

  EXECUTE patched;
END
$do$;