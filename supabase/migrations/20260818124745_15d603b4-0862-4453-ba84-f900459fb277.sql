ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS next_tick_due_at bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.encounters.next_tick_due_at IS
  'Authoritative epoch-ms boundary at which the next tick becomes due. Advanced by exactly one rate interval per granted claim (phase-preserving), never restamped from commit time, so per-tick processing latency is not added to the cadence.';

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

  -- Cadence authority: an explicit due boundary that advances by exactly one
  -- rate interval per granted claim. Legacy rows (0) fall back to the old
  -- commit-stamped derivation once, then become phase-preserving.
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
                              'next_due_at_ms', GREATEST(v_due, v_enc.lease_until));
  END IF;

  IF v_enc.tick_state = 'resolving' THEN
    IF NOT (v_enc.tick_mode = ANY(_supported_modes)) THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_enc.tick_mode,
                                'now_ms', v_now);
    END IF;
    v_token := gen_random_uuid();
    v_resolver := gen_random_uuid();
    UPDATE public.encounters
    SET claim_token = v_token,
        resolver_id = v_resolver,
        lease_until = v_now + _lease_ms,
        attempt = attempt + 1
    WHERE id = _encounter_id
    RETURNING resolving_tick, attempt INTO v_tick, v_enc.attempt;
    RETURN jsonb_build_object(
      'claimed', true, 'tick', v_tick, 'mode', v_enc.tick_mode,
      'claim_token', v_token, 'resolver_id', v_resolver,
      'lease_until', v_now + _lease_ms,
      'now_ms', v_now,
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
                              'next_due_at_ms', v_due);
  END IF;

  -- Phase-preserving advance: one interval from the boundary we just consumed.
  -- If the encounter fell more than one interval behind (suspended tab, slow
  -- resolver) the schedule re-bases on now so it cannot fire a burst.
  v_next_due := v_due + _rate_ms;
  IF v_next_due <= v_now THEN
    v_next_due := v_now + _rate_ms;
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
      attempt = 1
  WHERE id = _encounter_id
  RETURNING resolving_tick INTO v_tick;

  RETURN jsonb_build_object(
    'claimed', true, 'tick', v_tick, 'mode', v_mode,
    'claim_token', v_token, 'resolver_id', v_resolver,
    'lease_until', v_now + _lease_ms,
    'now_ms', v_now,
    'next_due_at_ms', v_next_due,
    'attempt', 1, 'reclaimed', false
  );
END;
$function$;