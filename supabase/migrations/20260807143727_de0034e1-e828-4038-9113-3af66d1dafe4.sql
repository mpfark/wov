-- Phase 8: the shared encounter tick is now the only ownership model.
CREATE OR REPLACE FUNCTION public.claim_encounter_tick(
  _encounter_id uuid,
  _rate_ms integer,
  _lease_ms integer,
  _caller text,
  _supported_modes text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_mode text;
  v_grace_ms integer := 15000;
  v_live boolean;
  v_token uuid;
  v_tick bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_encounter');
  END IF;

  IF v_enc.tick_at = 0 THEN
    UPDATE public.encounters SET tick_at = v_now WHERE id = _encounter_id;
    v_enc.tick_at := v_now;
  END IF;

  -- Derive authoritative mode
  SELECT EXISTS (
    SELECT 1
    FROM public.encounter_engagements e
    JOIN public.characters c ON c.id = e.character_id
    LEFT JOIN public.combat_sessions s
      ON (s.character_id = c.id OR s.party_id IN (
            SELECT pm.party_id FROM public.party_members pm
            WHERE pm.character_id = c.id AND pm.status = 'active'))
    WHERE e.encounter_id = _encounter_id
      AND c.hp > 0
      AND c.current_node_id = v_enc.node_id
      AND s.id IS NOT NULL
      AND s.last_tick_at > (v_now - v_grace_ms)
  ) INTO v_live;

  v_mode := CASE WHEN v_live THEN 'live' ELSE 'effects_only' END;

  IF v_enc.tick_state = 'resolving' AND v_enc.lease_until IS NOT NULL AND v_enc.lease_until > v_now THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_flight', 'mode', v_enc.tick_mode);
  END IF;

  IF v_enc.tick_state = 'resolving' THEN
    IF NOT (v_enc.tick_mode = ANY(_supported_modes)) THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_enc.tick_mode);
    END IF;
    v_token := gen_random_uuid();
    UPDATE public.encounters
    SET claim_token = v_token,
        resolver_id = gen_random_uuid(),
        lease_until = v_now + _lease_ms,
        attempt = attempt + 1
    WHERE id = _encounter_id
    RETURNING resolving_tick, attempt INTO v_tick, v_enc.attempt;
    RETURN jsonb_build_object(
      'claimed', true, 'tick', v_tick, 'mode', v_enc.tick_mode,
      'claim_token', v_token, 'attempt', v_enc.attempt, 'reclaimed', true
    );
  END IF;

  IF NOT (v_mode = ANY(_supported_modes)) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_mode);
  END IF;

  IF v_now - v_enc.tick_at < _rate_ms THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_due', 'mode', v_mode);
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.encounters
  SET tick_state = 'resolving',
      resolving_tick = tick_number + 1,
      tick_mode = v_mode,
      claim_token = v_token,
      resolver_id = gen_random_uuid(),
      lease_until = v_now + _lease_ms,
      attempt = 1
  WHERE id = _encounter_id
  RETURNING resolving_tick INTO v_tick;

  RETURN jsonb_build_object(
    'claimed', true, 'tick', v_tick, 'mode', v_mode,
    'claim_token', v_token, 'attempt', 1, 'reclaimed', false
  );
END;
$$;

DROP FUNCTION IF EXISTS public.shared_encounter_tick_enabled();
DELETE FROM public.app_secrets WHERE key = 'shared_encounter_tick';
ALTER TABLE public.encounters DROP COLUMN IF EXISTS tick_owner;

REVOKE ALL ON FUNCTION public.claim_encounter_tick(uuid, integer, integer, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_encounter_tick(uuid, integer, integer, text, text[]) TO service_role;