-- Combat2 ownership begins with authoritative hostility, not mere co-location.
-- Preserve the installed entry implementation behind a narrow engagement gate,
-- and provide one atomic entry + basic-attack path for deliberate hostility.
BEGIN;

ALTER FUNCTION public.combat_enter(uuid, uuid)
  RENAME TO combat_enter_without_engagement_gate;
REVOKE ALL ON FUNCTION public.combat_enter_without_engagement_gate(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat_enter_without_engagement_gate(uuid, uuid)
  TO service_role;

CREATE FUNCTION public.combat_enter(_character_id uuid, _request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_node uuid;
BEGIN
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'mode_refused', 'reason', 'maintenance');
  END IF;
  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_required');
  END IF;
  IF NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized', 'reason', 'character');
  END IF;
  SELECT current_node_id INTO v_node
  FROM public.characters
  WHERE id = _character_id;

  IF NOT EXISTS (
    SELECT 1
    FROM public.creatures c
    WHERE c.node_id = v_node
      AND c.is_alive
      AND c.is_aggressive
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.node_encounter e
    JOIN public.node_creature nc ON nc.encounter_id = e.id
    WHERE e.node_id = v_node
      AND e.status = 'active'
      AND nc.is_alive
      AND nc.engaged
  ) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_engagement');
  END IF;

  RETURN public.combat_enter_without_engagement_gate(_character_id, _request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.combat_enter(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat_enter(uuid, uuid) TO authenticated, service_role;

CREATE FUNCTION public.combat2_engage(
  _character_id uuid,
  _target_creature_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_node uuid;
  v_entry jsonb;
  v_intent jsonb;
BEGIN
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'mode_refused', 'reason', 'maintenance');
  END IF;
  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_required');
  END IF;
  IF NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized', 'reason', 'character');
  END IF;
  SELECT current_node_id INTO v_node FROM public.characters WHERE id = _character_id;
  IF v_node IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.creatures c
    WHERE c.id = _target_creature_id AND c.node_id = v_node AND c.is_alive
  ) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_target');
  END IF;

  -- The exception block is a subtransaction: a refused intent rolls entry back
  -- as well, so deliberate engagement is all-or-nothing and replay-safe.
  BEGIN
    v_entry := public.combat_enter_without_engagement_gate(_character_id, _request_id);
    IF NOT (
      (v_entry->>'ok' = 'true' AND v_entry->>'kind' IN ('entered', 'reentered', 'already_entered'))
      OR (v_entry->>'ok' = 'false' AND v_entry->>'kind' = 'already_present')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_refused';
    END IF;

    v_intent := public.combat_intent(
      (v_entry->>'encounter_id')::uuid,
      _character_id,
      'basic_attack',
      NULL,
      NULL,
      _target_creature_id,
      NULL,
      _request_id
    );
    IF v_intent->>'ok' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'intent_refused';
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('ok', false, 'kind', SQLERRM);
  END;

  RETURN v_intent || jsonb_build_object(
    'encounter_id', v_entry->>'encounter_id',
    'fighter_id', v_entry->>'fighter_id',
    'entry_seq', (v_entry->>'entry_seq')::bigint,
    'entry_kind', v_entry->>'kind'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_engage(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat2_engage(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;
