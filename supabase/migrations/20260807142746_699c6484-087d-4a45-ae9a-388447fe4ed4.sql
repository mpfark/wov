CREATE OR REPLACE FUNCTION public.encounter_reconcile(_node_id uuid)
RETURNS TABLE (
  encounter_id uuid,
  participants_purged int,
  sessions_reset int,
  status_after text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc uuid;
  v_purged int := 0;
  v_participants int;
  v_effects int;
  v_status text;
  v_last_activity timestamptz;
BEGIN
  SELECT id, status, last_activity_at
    INTO v_enc, v_status, v_last_activity
  FROM public.encounters
  WHERE node_id = _node_id
    AND encounter_key = 'default'
    AND status IN ('active','idle')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_enc IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 0, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  WITH del AS (
    DELETE FROM public.encounter_participants ep
    USING public.characters c
    WHERE ep.encounter_id = v_enc
      AND ep.character_id = c.id
      AND (c.current_node_id IS DISTINCT FROM _node_id OR c.hp <= 0)
    RETURNING ep.character_id
  )
  SELECT count(*)::int INTO v_purged FROM del;

  SELECT count(*)::int INTO v_participants
  FROM public.encounter_participants
  WHERE encounter_id = v_enc;

  SELECT count(*)::int INTO v_effects
  FROM public.active_effects
  WHERE node_id = _node_id;

  IF v_participants = 0 AND v_effects = 0 THEN
    IF v_status = 'idle' AND v_last_activity < now() - interval '30 minutes' THEN
      UPDATE public.encounters
         SET status = 'ended', ended_at = now()
       WHERE id = v_enc;
      v_status := 'ended';
    ELSIF v_status <> 'idle' THEN
      UPDATE public.encounters
         SET status = 'idle', last_activity_at = now()
       WHERE id = v_enc;
      v_status := 'idle';
    END IF;
  ELSIF v_status <> 'active' THEN
    UPDATE public.encounters
       SET status = 'active', last_activity_at = now()
     WHERE id = v_enc;
    v_status := 'active';
  END IF;

  RETURN QUERY SELECT v_enc, v_purged, 0, v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_reconcile(uuid) TO authenticated, service_role;