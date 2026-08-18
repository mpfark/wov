-- 1. Cadence: report the authoritative next-due boundary on cadence refusals.
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
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_encounter');
  END IF;

  IF v_enc.status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'encounter_ended');
  END IF;

  IF v_enc.tick_at = 0 THEN
    UPDATE public.encounters SET tick_at = v_now WHERE id = _encounter_id;
    v_enc.tick_at := v_now;
  END IF;

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
                              'next_due_at_ms', v_enc.lease_until);
  END IF;

  IF v_enc.tick_state = 'resolving' THEN
    IF NOT (v_enc.tick_mode = ANY(_supported_modes)) THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_enc.tick_mode);
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
      'attempt', v_enc.attempt, 'reclaimed', true
    );
  END IF;

  IF NOT (v_mode = ANY(_supported_modes)) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_mode);
  END IF;

  IF v_now - v_enc.tick_at < _rate_ms THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_due', 'mode', v_mode,
                              'next_due_at_ms', v_enc.tick_at + _rate_ms);
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
      attempt = 1
  WHERE id = _encounter_id
  RETURNING resolving_tick INTO v_tick;

  RETURN jsonb_build_object(
    'claimed', true, 'tick', v_tick, 'mode', v_mode,
    'claim_token', v_token, 'resolver_id', v_resolver,
    'lease_until', v_now + _lease_ms,
    'attempt', 1, 'reclaimed', false
  );
END;
$function$;

-- 2. Remove the unread contributions sink from the committer and the harness
-- teardown, then drop the table. Nothing reads it: reward attribution is owned
-- by public.encounter_attribution_roster.
DO $do$
DECLARE
  d text;
  block text := $blk$  INSERT INTO public.encounter_contributions
    (encounter_id, character_id, damage_dealt, healing_done, first_hit_at, last_hit_at)
  SELECT _encounter_id, (c->>'characterId')::uuid,
         COALESCE((c->>'damageDealt')::integer, 0), COALESCE((c->>'healingDone')::integer, 0),
         now(), now()
  FROM jsonb_array_elements(COALESCE(_proposed->'contributions', '[]'::jsonb)) AS c
  ON CONFLICT (encounter_id, character_id) DO UPDATE
    SET damage_dealt = public.encounter_contributions.damage_dealt + EXCLUDED.damage_dealt,
        healing_done = public.encounter_contributions.healing_done + EXCLUDED.healing_done,
        last_hit_at = now();
$blk$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'commit_encounter_tick_v2';

  IF position(block IN d) = 0 THEN
    RAISE EXCEPTION 'contribution block not found in commit_encounter_tick_v2';
  END IF;
  d := replace(d, block, '');
  EXECUTE d;

  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'harness_teardown';
  d := replace(d,
    '  delete from public.encounter_contributions where encounter_id = any(v_encounters);' || E'\n',
    '');
  EXECUTE d;
END
$do$;

DROP TABLE IF EXISTS public.encounter_contributions;