
-- ============================================================
-- M5: Encounter reconciliation
-- Single entry point for node-level housekeeping. Called from
-- combat-catchup (node entry / offscreen wake-up) and safe to
-- call ad-hoc.
--
-- Responsibilities:
--   1. Purge participants whose current_node_id != encounter.node_id
--      (belt-and-braces vs the M4 trigger; catches any pre-trigger rows).
--   2. Reset last_tick_at on stale combat_sessions in this node so a
--      re-entering player doesn't process a backlog of elapsed ticks.
--   3. Flip encounters to 'idle' when no participants remain AND no
--      active_effects exist in the node.
--   4. Mark long-idle encounters (>30 min) as 'ended' so tables don't
--      grow unbounded. Ended encounters are excluded from ensure().
--
-- Does NOT touch creature HP — that stays owned by the damage RPCs.
-- ============================================================

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
  v_reset int := 0;
  v_participants int;
  v_effects int;
  v_status text;
  v_last_activity timestamptz;
BEGIN
  -- Locate the active encounter for this node (if any).
  SELECT id, status, last_activity_at
    INTO v_enc, v_status, v_last_activity
  FROM public.encounters
  WHERE node_id = _node_id
    AND encounter_key = 'default'
    AND status IN ('active','idle')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_enc IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

    -- 1. Purge stale participants (character moved without triggering M4).
    WITH del AS (
      DELETE FROM public.encounter_participants ep
      USING public.characters c
      WHERE ep.encounter_id = v_enc
        AND ep.character_id = c.id
        AND (c.current_node_id IS DISTINCT FROM _node_id OR c.hp <= 0)
      RETURNING ep.character_id
    )
    SELECT count(*)::int INTO v_purged FROM del;
  END IF;

  -- 2. Reset stale combat_sessions ticker for the node.
  WITH upd AS (
    UPDATE public.combat_sessions
       SET last_tick_at = extract(epoch from now()) * 1000
     WHERE node_id = _node_id
     RETURNING id
  )
  SELECT count(*)::int INTO v_reset FROM upd;

  IF v_enc IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, v_reset, NULL::text;
    RETURN;
  END IF;

  -- 3. Status flip: idle when nobody's engaged and no lingering effects.
  SELECT count(*)::int INTO v_participants
  FROM public.encounter_participants
  WHERE encounter_id = v_enc;

  SELECT count(*)::int INTO v_effects
  FROM public.active_effects
  WHERE node_id = _node_id;

  IF v_participants = 0 AND v_effects = 0 THEN
    -- 4. End if idle > 30 min, else mark idle.
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
    -- Something's happening again — reactivate.
    UPDATE public.encounters
       SET status = 'active', last_activity_at = now()
     WHERE id = v_enc;
    v_status := 'active';
  END IF;

  RETURN QUERY SELECT v_enc, v_purged, v_reset, v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_reconcile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_reconcile(uuid) TO authenticated, service_role;

-- ── ensure() must skip 'ended' encounters, else it would re-use a
--     tombstoned row. Recreate it to filter on status='active'/'idle'
--     and reactivate idle ones on join.
CREATE OR REPLACE FUNCTION public.encounter_ensure_for_character(_character_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node_id uuid;
  v_encounter_id uuid;
  v_status text;
BEGIN
  SELECT current_node_id INTO v_node_id
  FROM public.characters
  WHERE id = _character_id;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'character % has no current_node_id', _character_id;
  END IF;

  SELECT id, status INTO v_encounter_id, v_status
  FROM public.encounters
  WHERE node_id = v_node_id
    AND encounter_key = 'default'
    AND status IN ('active','idle')
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_encounter_id IS NULL THEN
    INSERT INTO public.encounters (node_id, encounter_key, status)
    VALUES (v_node_id, 'default', 'active')
    RETURNING id INTO v_encounter_id;
  ELSIF v_status = 'idle' THEN
    UPDATE public.encounters
       SET status = 'active', last_activity_at = now()
     WHERE id = v_encounter_id;
  END IF;

  INSERT INTO public.encounter_participants (encounter_id, character_id, last_action_at)
  VALUES (v_encounter_id, _character_id, now())
  ON CONFLICT (character_id) DO UPDATE
     SET last_action_at = now(),
         encounter_id   = EXCLUDED.encounter_id;

  RETURN v_encounter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_ensure_for_character(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_ensure_for_character(uuid) TO service_role;
