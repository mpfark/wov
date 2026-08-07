-- Encounter tick cursor / claim / lease / mode
ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS tick_number bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tick_at bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tick_state text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS resolving_tick bigint,
  ADD COLUMN IF NOT EXISTS tick_mode text,
  ADD COLUMN IF NOT EXISTS resolver_id uuid,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS lease_until bigint,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tick_owner text;

-- Shared per-tick result batches
CREATE TABLE public.encounter_tick_batches (
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  tick_number bigint NOT NULL,
  batch_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (encounter_id, tick_number)
);

CREATE INDEX idx_encounter_tick_batches_created ON public.encounter_tick_batches (encounter_id, created_at);

GRANT SELECT ON public.encounter_tick_batches TO authenticated;
GRANT ALL ON public.encounter_tick_batches TO service_role;
ALTER TABLE public.encounter_tick_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants read their encounter batches"
ON public.encounter_tick_batches FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.encounter_participants p
    JOIN public.characters c ON c.id = p.character_id
    WHERE p.encounter_id = encounter_tick_batches.encounter_id
      AND c.user_id = auth.uid()
  )
);

-- Feature switch (off unless explicitly enabled)
CREATE OR REPLACE FUNCTION public.shared_encounter_tick_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT lower(value) IN ('on','true','1')
     FROM public.app_secrets WHERE key = 'shared_encounter_tick'),
    false
  )
$$;

-- Claim one logical tick, capability-checked under the lock
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
  v_owner text;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_encounter');
  END IF;

  -- Latch ownership model for the life of the encounter
  v_owner := v_enc.tick_owner;
  IF v_owner IS NULL THEN
    v_owner := CASE WHEN public.shared_encounter_tick_enabled() THEN 'shared' ELSE 'legacy' END;
    UPDATE public.encounters SET tick_owner = v_owner WHERE id = _encounter_id;
  END IF;

  IF v_owner <> 'shared' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'legacy_owner', 'tick_owner', v_owner);
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
    -- Expired lease: same tick, same stored mode, still capability-checked
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

  -- Idle
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

-- Commit one logical tick: token-gated, atomic, self-pruning
CREATE OR REPLACE FUNCTION public.commit_encounter_tick(
  _encounter_id uuid,
  _tick bigint,
  _claim_token uuid,
  _batch_id uuid,
  _rate_ms integer,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enc public.encounters;
  v_consumed uuid[];
  v_rejected jsonb;
  v_item jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'no_encounter');
  END IF;

  IF v_enc.tick_number >= _tick THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'already_committed', 'tick_number', v_enc.tick_number);
  END IF;

  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'stale_claim');
  END IF;

  SELECT COALESCE(array_agg((x)::uuid), '{}')
  INTO v_consumed
  FROM jsonb_array_elements_text(COALESCE(_payload->'consumed_action_ids', '[]'::jsonb)) AS x;

  IF array_length(v_consumed, 1) > 0 THEN
    UPDATE public.combat_actions
    SET status = 'consumed', consumed_tick = _tick
    WHERE id = ANY(v_consumed) AND status = 'pending';
  END IF;

  v_rejected := COALESCE(_payload->'rejected_actions', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_rejected) LOOP
    UPDATE public.combat_actions
    SET status = 'rejected',
        consumed_tick = _tick,
        reject_reason = COALESCE(v_item->>'reason', 'rejected')
    WHERE id = (v_item->>'id')::uuid AND status = 'pending';
  END LOOP;

  INSERT INTO public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
  VALUES (_encounter_id, _tick, _batch_id, COALESCE(_payload->'batch', '{}'::jsonb))
  ON CONFLICT (encounter_id, tick_number) DO NOTHING;

  DELETE FROM public.encounter_tick_batches
  WHERE encounter_id = _encounter_id AND created_at < now() - interval '60 seconds';

  UPDATE public.encounters
  SET tick_number = _tick,
      tick_at = GREATEST(tick_at + _rate_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint - _rate_ms),
      tick_state = 'idle',
      resolving_tick = NULL,
      claim_token = NULL,
      resolver_id = NULL,
      lease_until = NULL,
      attempt = 0,
      last_activity_at = now()
  WHERE id = _encounter_id;

  RETURN jsonb_build_object('committed', true, 'tick', _tick, 'batch_id', _batch_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_encounter_tick(uuid, integer, integer, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_encounter_tick(uuid, bigint, uuid, uuid, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shared_encounter_tick_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_encounter_tick(uuid, integer, integer, text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick(uuid, bigint, uuid, uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.shared_encounter_tick_enabled() TO authenticated, service_role;