-- ============================================================
-- Authoritative player-input batch: combat_intent + combat_flee.
-- Additive only. These RPCs record INTENT and PRESENCE only; they never
-- resolve an attack, advance a tick, spend CP or create a tick batch.
-- Combat stays closed: both refuse normal use unless combat_config
-- combat_mode = 'open'.
-- ============================================================

-- ---------- idempotency keys ----------
ALTER TABLE public.node_intent
  ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS node_intent_request_uniq
  ON public.node_intent (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.node_pending_event
  ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS node_pending_event_request_uniq
  ON public.node_pending_event (request_id) WHERE request_id IS NOT NULL;

-- ---------- shared mode gate ----------
CREATE OR REPLACE FUNCTION public.combat_mode_is_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value = 'open' FROM public.combat_config WHERE key = 'combat_mode'),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.combat_mode_is_open() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.combat_mode_is_open() FROM anon;
GRANT EXECUTE ON FUNCTION public.combat_mode_is_open() TO authenticated, service_role;

-- A stance is an authored ability that reserves CP. Availability itself is
-- always the authored class/ability assignment rule.
CREATE OR REPLACE FUNCTION public.ability_key_is_stance(_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.abilities a
    LEFT JOIN public.class_ability_assignments ca ON ca.ability_id = a.id
    WHERE a.status = 'active'
      AND (a.ability_key = _key OR ca.class_ability_key = _key)
      AND COALESCE(a.cp_reserve_pct, 0) > 0
  );
$$;
REVOKE ALL ON FUNCTION public.ability_key_is_stance(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ability_key_is_stance(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ability_key_is_stance(text) TO authenticated, service_role;

-- ============================================================
-- combat_intent
--   Deterministic rule: AT MOST ONE pending intent per character
--   (node_intent_one_pending_per_character). Latest valid intent wins: a
--   previously pending intent is atomically rejected as 'superseded' in the
--   same transaction as the new insert. A repeated _request_id never queues a
--   second action; it returns the already-queued row unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.combat_intent(
  _encounter_id uuid,
  _character_id uuid,
  _intent_kind text,
  _ability_key text,
  _stance_key text,
  _target_creature_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e            public.node_encounter;
  v_existing   public.node_intent;
  v_key        text;
  v_new_id     uuid;
  v_new_seq    bigint;
  v_superseded uuid[];
BEGIN
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'mode_refused', 'reason', 'maintenance');
  END IF;

  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_required');
  END IF;
  IF _intent_kind IS NULL OR _intent_kind NOT IN ('ability','stance_activate','stance_drop') THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'intent_kind');
  END IF;
  IF NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized', 'reason', 'character');
  END IF;

  -- serialize concurrent submissions for this character
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_intent:' || _character_id::text, 0));

  SELECT * INTO v_existing FROM public.node_intent WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_existing.character_id <> _character_id THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'already_queued',
                              'intent_id', v_existing.id, 'seq', v_existing.seq,
                              'status', v_existing.status);
  END IF;

  SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_encounter');
  END IF;
  IF e.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_accepting_input', 'reason', e.status);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.characters c
                 WHERE c.id = _character_id AND c.current_node_id = e.node_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_at_node');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                 WHERE nf.encounter_id = _encounter_id
                   AND nf.character_id = _character_id
                   AND nf.present) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_present');
  END IF;

  -- ---------- shape + authored availability ----------
  IF _intent_kind = 'ability' THEN
    IF _ability_key IS NULL OR _stance_key IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'shape_ability');
    END IF;
    v_key := _ability_key;
    IF NOT public.character_can_use_ability(_character_id, v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'ability_unavailable', 'ability_key', v_key);
    END IF;
    IF public.ability_key_is_stance(v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'stance_requires_stance_intent');
    END IF;
  ELSE
    IF _stance_key IS NULL OR _ability_key IS NOT NULL OR _target_creature_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'shape_stance');
    END IF;
    v_key := _stance_key;
    IF NOT public.ability_key_is_stance(v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'not_a_stance');
    END IF;
    IF NOT public.character_can_use_ability(_character_id, v_key) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'stance_unavailable', 'stance_key', v_key);
    END IF;
  END IF;

  -- ---------- target ----------
  IF _target_creature_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.node_creature nc
                   WHERE nc.encounter_id = _encounter_id
                     AND nc.creature_id = _target_creature_id
                     AND nc.is_alive) THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_target',
                                'reason', 'not_in_encounter_or_dead');
    END IF;
  END IF;

  -- ---------- latest valid intent wins, atomically ----------
  WITH s AS (
    UPDATE public.node_intent
       SET status = 'rejected', reject_reason = 'superseded'
     WHERE character_id = _character_id AND status = 'pending'
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_superseded FROM s;

  INSERT INTO public.node_intent
    (encounter_id, character_id, intent_kind, ability_key, stance_key,
     target_creature_id, status, request_id)
  VALUES
    (_encounter_id, _character_id, _intent_kind,
     CASE WHEN _intent_kind = 'ability' THEN _ability_key ELSE NULL END,
     CASE WHEN _intent_kind = 'ability' THEN NULL ELSE _stance_key END,
     _target_creature_id, 'pending', _request_id)
  RETURNING id, seq INTO v_new_id, v_new_seq;

  RETURN jsonb_build_object('ok', true, 'kind', 'queued',
                            'intent_id', v_new_id, 'seq', v_new_seq,
                            'intent_kind', _intent_kind,
                            'superseded', to_jsonb(v_superseded));
END;
$$;
REVOKE ALL ON FUNCTION public.combat_intent(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.combat_intent(uuid, uuid, text, text, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid, uuid, text, text, text, uuid, uuid)
  TO authenticated, service_role;

-- ============================================================
-- combat_flee
--   Authoritative combat departure only. One transaction:
--     1. the fighter becomes absent immediately;
--     2. node_participation is preserved untouched;
--     3. exactly one node_pending_event records the flee, unconsumed;
--     4. state_version is bumped and any in-flight claim invalidated, so an
--        already-claimed stale snapshot can never commit against the
--        departed character.
--   It never resolves a cast, ticks, moves the character, awards anything,
--   touches effects/CP, deletes the encounter or modifies another fighter.
-- ============================================================
CREATE OR REPLACE FUNCTION public.combat_flee(
  _encounter_id uuid,
  _character_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e           public.node_encounter;
  v_prior     public.node_pending_event;
  v_fighter   uuid;
  v_event_id  uuid;
  v_version   bigint;
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

  SELECT * INTO v_prior FROM public.node_pending_event WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_prior.actor_character_id IS DISTINCT FROM _character_id
       OR v_prior.encounter_id <> _encounter_id THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'already_fled', 'event_id', v_prior.id);
  END IF;

  SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_encounter');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.characters c
                 WHERE c.id = _character_id AND c.current_node_id = e.node_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_at_node');
  END IF;

  SELECT nf.id INTO v_fighter
  FROM public.node_fighter nf
  WHERE nf.encounter_id = _encounter_id
    AND nf.character_id = _character_id
    AND nf.present
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_present');
  END IF;

  UPDATE public.node_fighter
     SET present = false, left_at = now(), updated_at = now()
   WHERE id = v_fighter;

  INSERT INTO public.node_pending_event
    (encounter_id, event_type, actor_character_id, payload, request_id)
  VALUES
    (_encounter_id, 'fighter_fled', _character_id,
     jsonb_build_object('fighter_id', v_fighter, 'node_id', e.node_id),
     _request_id)
  RETURNING id INTO v_event_id;

  UPDATE public.node_encounter
     SET state_version     = state_version + 1,
         claim_token       = NULL,
         claimed_tick      = NULL,
         claim_expires_at  = NULL,
         updated_at        = now()
   WHERE id = _encounter_id
  RETURNING state_version INTO v_version;

  RETURN jsonb_build_object('ok', true, 'kind', 'fled',
                            'event_id', v_event_id,
                            'fighter_id', v_fighter,
                            'state_version', v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.combat_flee(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.combat_flee(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.combat_flee(uuid, uuid, uuid) TO authenticated, service_role;