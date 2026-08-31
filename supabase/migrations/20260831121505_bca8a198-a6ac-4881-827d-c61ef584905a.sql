-- Advisory, read-only candidate discovery for one bounded Combat2 dispatch.
CREATE OR REPLACE FUNCTION public.combat2_due_nodes(_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 10), 1), 25);
  v_candidates jsonb;
BEGIN
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object(
      'ok', false, 'kind', 'maintenance', 'limit', v_limit,
      'candidate_count', 0, 'candidates', '[]'::jsonb
    );
  END IF;

  IF NOT public.world_state_is_awake() THEN
    RETURN jsonb_build_object(
      'ok', false, 'kind', 'world_asleep', 'limit', v_limit,
      'candidate_count', 0, 'candidates', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'node_id', due.node_id,
    'encounter_id', due.id,
    'next_due_at', due.next_due_at
  ) ORDER BY due.next_due_at, due.node_id), '[]'::jsonb)
  INTO v_candidates
  FROM (
    SELECT e.id, e.node_id, e.next_due_at
    FROM public.node_encounter e
    WHERE e.status = 'active'
      AND e.next_due_at <= now()
      AND (
        e.claimed_tick IS NULL
        OR e.claim_expires_at IS NULL
        OR e.claim_expires_at <= now()
      )
    ORDER BY e.next_due_at, e.node_id
    LIMIT v_limit
  ) due;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'candidates',
    'limit', v_limit,
    'candidate_count', jsonb_array_length(v_candidates),
    'candidates', v_candidates
  );
END;
$$;

REVOKE ALL ON FUNCTION public.combat2_due_nodes(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.combat2_due_nodes(integer) FROM anon;
REVOKE ALL ON FUNCTION public.combat2_due_nodes(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_due_nodes(integer) TO service_role;