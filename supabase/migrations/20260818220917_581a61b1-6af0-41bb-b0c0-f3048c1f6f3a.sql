CREATE OR REPLACE FUNCTION public.commit_encounter_tick_v3(
  _encounter_id uuid,
  _tick bigint,
  _claim_token uuid,
  _batch_id uuid,
  _snapshot_version integer,
  _encounter_version integer,
  _snapshot_scope jsonb,
  _snapshot_digest jsonb,
  _proposed jsonb,
  _reserved_boundary_at bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reserved bigint;
  v_state text;
  v_res jsonb;
  v_next_due bigint;
BEGIN
  -- Same advisory lock key the inner commit takes (xact locks are re-entrant),
  -- so the fence below and the commit itself are one atomic decision.
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT reserved_boundary_at, tick_state INTO v_reserved, v_state
  FROM public.encounters WHERE id = _encounter_id FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'no_encounter');
  END IF;

  -- Boundary fence: the caller names the scheduled boundary its claim reserved.
  -- If the stored reservation is a different boundary, this resolver's claim was
  -- superseded (reclaim after lease loss) and nothing may land.
  IF _reserved_boundary_at IS NOT NULL
     AND v_reserved IS NOT NULL
     AND v_reserved <> _reserved_boundary_at THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'boundary_conflict',
                              'expected', _reserved_boundary_at,
                              'actual', v_reserved);
  END IF;

  v_res := public.commit_encounter_tick_v2(
    _encounter_id, _tick, _claim_token, _batch_id, _snapshot_version,
    _encounter_version, _snapshot_scope, _snapshot_digest, _proposed);

  IF COALESCE((v_res->>'committed')::boolean, false) THEN
    -- The reservation is consumed. The schedule itself is NOT recomputed here:
    -- claim_encounter_tick already advanced next_tick_due_at phase-preservingly,
    -- so cadence never absorbs commit processing time.
    UPDATE public.encounters
    SET reserved_boundary_at = NULL
    WHERE id = _encounter_id
    RETURNING next_tick_due_at INTO v_next_due;

    v_res := v_res || jsonb_build_object(
      'committed_at_ms', (v_res->>'committed_at')::bigint,
      'next_due_at_ms', v_next_due,
      'reserved_boundary_at_ms', _reserved_boundary_at);
  END IF;

  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_encounter_tick_v3(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick_v3(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb, bigint) TO service_role;