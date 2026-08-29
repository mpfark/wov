-- Prevent duplicate fighter rows per encounter (entry/re-entry reuses one row).
CREATE UNIQUE INDEX IF NOT EXISTS node_fighter_encounter_character_uniq
  ON public.node_fighter (encounter_id, character_id);

CREATE OR REPLACE FUNCTION public.combat_enter(_character_id uuid, _request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prior     public.node_pending_event;
  v_node      uuid;
  v_node2     uuid;
  v_party     uuid;
  e           public.node_encounter;
  v_living    integer;
  f           public.node_fighter;
  v_fighter   uuid;
  v_seq       bigint;
  v_reentry   boolean := false;
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

  -- Request-scoped idempotency: the same request always returns the same identity.
  SELECT * INTO v_prior FROM public.node_pending_event WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_prior.actor_character_id IS DISTINCT FROM _character_id
       OR v_prior.event_type <> 'fighter_entered' THEN
      RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'kind', 'already_entered',
                              'encounter_id', v_prior.encounter_id,
                              'event_id', v_prior.id,
                              'fighter_id', v_prior.payload->>'fighter_id',
                              'entry_seq', (v_prior.payload->>'entry_seq')::bigint);
  END IF;

  SELECT current_node_id INTO v_node FROM public.characters WHERE id = _character_id;
  IF v_node IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_node');
  END IF;

  -- Node-scoped serialization: one encounter per node, deterministic entry order.
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:' || v_node::text, 0));

  -- The node must still be the character's node once the lock is held.
  SELECT current_node_id INTO v_node2 FROM public.characters WHERE id = _character_id;
  IF v_node2 IS DISTINCT FROM v_node THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'node_changed');
  END IF;

  SELECT count(*) INTO v_living
  FROM public.creatures cr
  WHERE cr.node_id = v_node AND cr.is_alive = true;
  IF v_living = 0 THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_living_creatures');
  END IF;

  SELECT * INTO e FROM public.node_encounter WHERE node_id = v_node FOR UPDATE;
  IF FOUND AND e.status <> 'active' THEN
    -- An ended encounter is never reopened: its transient spawn, participation,
    -- death and reward state belongs to a previous generation.
    DELETE FROM public.node_encounter WHERE id = e.id;
    e := NULL;
  END IF;

  IF e.id IS NULL THEN
    INSERT INTO public.node_encounter (node_id, status, next_due_at)
    VALUES (v_node, 'active', now())
    RETURNING * INTO e;
  END IF;

  -- Initialize the current creature-spawn roster from authoritative state only.
  INSERT INTO public.node_creature (encounter_id, creature_id, spawn_seq, hp, is_alive)
  SELECT e.id, cr.id, cr.spawn_seq,
         GREATEST(1, COALESCE(NULLIF(cr.hp, 0), cr.max_hp)), true
  FROM public.creatures cr
  WHERE cr.node_id = v_node AND cr.is_alive = true
  ON CONFLICT (creature_id, spawn_seq) DO NOTHING;

  SELECT party_id INTO v_party FROM public.party_members WHERE character_id = _character_id LIMIT 1;

  SELECT * INTO f FROM public.node_fighter
   WHERE encounter_id = e.id AND character_id = _character_id
   FOR UPDATE;

  IF FOUND AND f.present THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'already_present',
                              'encounter_id', e.id,
                              'fighter_id', f.id,
                              'entry_seq', f.entry_seq);
  END IF;

  v_seq := nextval('node_fighter_entry_seq_seq');

  IF FOUND THEN
    v_reentry := true;
    UPDATE public.node_fighter
       SET present = true, left_at = NULL, entry_seq = v_seq,
           joined_at = now(), party_id_at_entry = v_party, updated_at = now()
     WHERE id = f.id
    RETURNING id INTO v_fighter;
  ELSE
    INSERT INTO public.node_fighter
      (encounter_id, character_id, entry_seq, present, party_id_at_entry, joined_at)
    VALUES (e.id, _character_id, v_seq, true, v_party, now())
    RETURNING id INTO v_fighter;
  END IF;

  -- Newest present fighter tanks every living creature in this encounter.
  UPDATE public.node_creature
     SET tank_fighter_id = v_fighter, updated_at = now()
   WHERE encounter_id = e.id AND is_alive = true;

  INSERT INTO public.node_pending_event
    (encounter_id, event_type, actor_character_id, payload, request_id)
  VALUES
    (e.id, 'fighter_entered', _character_id,
     jsonb_build_object('fighter_id', v_fighter, 'node_id', v_node,
                        'entry_seq', v_seq, 'reentry', v_reentry),
     _request_id)
  RETURNING id INTO v_event_id;

  -- Invalidate any in-flight claim: it was snapshotted with the old roster.
  UPDATE public.node_encounter
     SET state_version    = state_version + 1,
         claim_token      = NULL,
         claimed_tick     = NULL,
         claim_expires_at = NULL,
         updated_at       = now()
   WHERE id = e.id
  RETURNING state_version INTO v_version;

  RETURN jsonb_build_object('ok', true,
                            'kind', CASE WHEN v_reentry THEN 'reentered' ELSE 'entered' END,
                            'encounter_id', e.id,
                            'node_id', v_node,
                            'fighter_id', v_fighter,
                            'entry_seq', v_seq,
                            'event_id', v_event_id,
                            'state_version', v_version);
END;
$function$;

REVOKE ALL ON FUNCTION public.combat_enter(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.combat_enter(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.combat_enter(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.combat_enter(uuid, uuid) TO service_role;

-- Smallest correction to fleeing: the stored focus cache must fall back to the
-- next-newest present fighter (or clear) when the current tank leaves.
CREATE OR REPLACE FUNCTION public.combat_flee(_encounter_id uuid, _character_id uuid, _request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  e           public.node_encounter;
  v_prior     public.node_pending_event;
  v_fighter   uuid;
  v_next      uuid;
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

  SELECT nf.id INTO v_next
  FROM public.node_fighter nf
  WHERE nf.encounter_id = _encounter_id AND nf.present
  ORDER BY nf.entry_seq DESC
  LIMIT 1;

  UPDATE public.node_creature
     SET tank_fighter_id = v_next, updated_at = now()
   WHERE encounter_id = _encounter_id
     AND is_alive = true
     AND tank_fighter_id IS DISTINCT FROM v_next;

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
                            'next_tank_fighter_id', v_next,
                            'state_version', v_version);
END;
$function$;