ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS reserved_boundary_at bigint;

COMMENT ON COLUMN public.encounters.reserved_boundary_at IS
  'Scheduled simulation boundary (epoch ms) reserved by the current claim. Rolled back into next_tick_due_at when a claim is released without a commit, so a failed tick is retried at its intended phase instead of forfeiting an interval.';

CREATE OR REPLACE FUNCTION public.claim_encounter_tick(_encounter_id uuid, _rate_ms integer, _lease_ms integer, _caller text, _supported_modes text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_mode text;
  v_grace_ms integer := 15000;
  v_live boolean;
  v_token uuid;
  v_resolver uuid;
  v_tick bigint;
  v_due bigint;
  v_next_due bigint;
  v_max_backlog integer := 30;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_encounter', 'now_ms', v_now);
  END IF;

  IF v_enc.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'encounter_ended', 'now_ms', v_now);
  END IF;

  IF v_enc.tick_at = 0 THEN
    UPDATE public.encounters SET tick_at = v_now WHERE id = _encounter_id;
    v_enc.tick_at := v_now;
  END IF;

  -- Cadence authority: an explicit due boundary. Legacy rows (0) fall back to
  -- the old commit-stamped derivation once, then become phase-preserving.
  v_due := COALESCE(NULLIF(v_enc.next_tick_due_at, 0), v_enc.tick_at + _rate_ms);

  SELECT EXISTS (
    SELECT 1
    FROM public.encounter_engagements e
    JOIN public.characters c ON c.id = e.character_id
    JOIN public.encounter_participants p
      ON p.encounter_id = e.encounter_id AND p.character_id = e.character_id
    WHERE e.encounter_id = _encounter_id
      AND c.hp > 0
      AND c.current_node_id = v_enc.node_id
      AND p.last_action_at > (to_timestamp((v_now - v_grace_ms) / 1000.0))
  ) INTO v_live;

  v_mode := CASE WHEN v_live THEN 'live' ELSE 'effects_only' END;

  IF v_enc.tick_state = 'resolving' AND v_enc.lease_until IS NOT NULL AND v_enc.lease_until > v_now THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_flight', 'mode', v_enc.tick_mode,
                              'now_ms', v_now,
                              'boundary_at_ms', v_due,
                              'next_due_at_ms', GREATEST(v_due, v_enc.lease_until));
  END IF;

  IF v_enc.tick_state = 'resolving' THEN
    IF NOT (v_enc.tick_mode = ANY(_supported_modes)) THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_enc.tick_mode,
                                'now_ms', v_now);
    END IF;
    -- Reclaim of an abandoned lease: same tick number, same reserved boundary.
    -- Nothing about the schedule moves, so a resolver crash costs no phase.
    v_token := gen_random_uuid();
    v_resolver := gen_random_uuid();
    UPDATE public.encounters
    SET claim_token = v_token,
        resolver_id = v_resolver,
        lease_until = v_now + _lease_ms,
        reserved_boundary_at = COALESCE(reserved_boundary_at, v_due),
        attempt = attempt + 1
    WHERE id = _encounter_id
    RETURNING resolving_tick, attempt, reserved_boundary_at INTO v_tick, v_enc.attempt, v_enc.reserved_boundary_at;
    RETURN jsonb_build_object(
      'claimed', true, 'tick', v_tick, 'mode', v_enc.tick_mode,
      'claim_token', v_token, 'resolver_id', v_resolver,
      'lease_until', v_now + _lease_ms,
      'now_ms', v_now,
      'boundary_at_ms', COALESCE(v_enc.reserved_boundary_at, v_due),
      'next_due_at_ms', v_due,
      'attempt', v_enc.attempt, 'reclaimed', true
    );
  END IF;

  IF NOT (v_mode = ANY(_supported_modes)) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_mode,
                              'now_ms', v_now);
  END IF;

  IF v_now < v_due THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_due', 'mode', v_mode,
                              'now_ms', v_now,
                              'boundary_at_ms', v_due,
                              'next_due_at_ms', v_due);
  END IF;

  -- Phase-preserving advance: whole intervals measured from the boundary we
  -- just consumed, never from `now`, so a slow tick cannot move the phase by
  -- its own processing duration. A long suspension is bounded so the encounter
  -- can never owe an unbounded backlog of immediately-due ticks.
  v_next_due := v_due + _rate_ms;
  IF v_next_due <= v_now THEN
    IF (v_now - v_due) > (v_max_backlog::bigint * _rate_ms) THEN
      v_next_due := v_now + _rate_ms;
    ELSE
      v_next_due := v_due + _rate_ms * ((v_now - v_due) / _rate_ms + 1);
    END IF;
  END IF;

  v_token := gen_random_uuid();
  v_resolver := gen_random_uuid();
  UPDATE public.encounters
  SET tick_state = 'resolving',
      resolving_tick = tick_number + 1,
      tick_mode = v_mode,
      claim_token = v_token,
      resolver_id = v_resolver,
      lease_until = v_now + _lease_ms,
      next_tick_due_at = v_next_due,
      reserved_boundary_at = v_due,
      attempt = 1
  WHERE id = _encounter_id
  RETURNING resolving_tick INTO v_tick;

  RETURN jsonb_build_object(
    'claimed', true, 'tick', v_tick, 'mode', v_mode,
    'claim_token', v_token, 'resolver_id', v_resolver,
    'lease_until', v_now + _lease_ms,
    'now_ms', v_now,
    'boundary_at_ms', v_due,
    'next_due_at_ms', v_next_due,
    'attempt', 1, 'reclaimed', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_encounter_tick(_encounter_id uuid, _tick bigint, _claim_token uuid, _reason text DEFAULT 'resolver_error'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_restored bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));
  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id FOR UPDATE;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no_encounter');
  END IF;
  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token THEN
    RETURN jsonb_build_object('released', false, 'reason', 'stale_claim');
  END IF;

  -- Ownership plus schedule rollback. A claim that never committed must not
  -- forfeit the interval it reserved: restoring the reserved boundary makes the
  -- intended tick due again immediately, at its intended phase.
  v_restored := COALESCE(v_enc.reserved_boundary_at, v_enc.next_tick_due_at);

  UPDATE public.encounters
  SET tick_state = 'idle', resolving_tick = NULL, claim_token = NULL,
      resolver_id = NULL, lease_until = NULL, attempt = 0,
      next_tick_due_at = v_restored,
      reserved_boundary_at = NULL
  WHERE id = _encounter_id;

  RETURN jsonb_build_object('released', true, 'tick', _tick,
                            'next_due_at_ms', v_restored,
                            'diagnostic_reason', _reason);
END;
$function$;