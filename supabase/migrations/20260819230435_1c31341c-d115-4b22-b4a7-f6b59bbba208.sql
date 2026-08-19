DO $mig$
DECLARE
  v_src text;
  v_old text := '          bhp = COALESCE((v_item->>''bhp'')::integer, bhp)';
  v_new text := '          bhp = COALESCE(bhp, 0) + COALESCE((v_item->>''renown'')::integer, 0)';
BEGIN
  v_src := pg_get_functiondef(
    'public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb)'::regprocedure
  );

  IF position(v_old in v_src) = 0 THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2: expected Renown reward assignment not found';
  END IF;

  -- Renown arrives in the proposal as a DELTA. The spendable balance is stored
  -- in the legacy `bhp` column and must be incremented, not overwritten with a
  -- key the resolver never sends (which left it permanently unchanged).
  v_src := replace(v_src, v_old, v_new);
  EXECUTE v_src;
END
$mig$;