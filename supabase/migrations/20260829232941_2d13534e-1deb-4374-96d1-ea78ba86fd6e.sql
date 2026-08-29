CREATE OR REPLACE FUNCTION public.combat_enter(_character_id uuid, _request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prior       public.node_pending_event;
  v_node        uuid;
  v_node2       uuid;
  v_party       uuid;
  e             public.node_encounter;
  v_living      integer;
  f             public.node_fighter;
  v_fighter     uuid;
  v_seq         bigint;
  v_reentry     boolean := false;
  v_reactivated boolean := false;
  v_event_id    uuid;
  v_version     bigint;
BEGIN
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'mode_refused', 'reason', 'maintenance');
  END IF;

  IF _request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'invalid_request', 'reason', 'request_id_required');
  END IF;
  -- Ownership is established BEFORE any request-id lookup, so a known request
  -- UUID can never disclose another caller's fighter, event or encounter identity.
  IF NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_authorized', 'reason', 'character');
  END IF;

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

  -- Node-scoped serialization: one persistent encounter authority per node.
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:' || v_node::text, 0));

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

  IF NOT FOUND THEN
    INSERT INTO public.node_encounter (node_id, status, next_due_at)
    VALUES (v_node, 'active', now())
    RETURNING * INTO e;
  ELSIF e.status <> 'active' THEN
    -- The encounter is the node's persistent authority: it is REUSED, never
    -- deleted. Tick history, batches, logs, reward claims, participation and
    -- historical creature-spawn rows all survive; `tick` stays monotonic.
    v_reactivated := true;

    -- Cross-generation hygiene: no fighter is present merely because the
    -- encounter reactivated, no previous-generation intent may resolve, and no
    -- undelivered previous-generation event may be replayed. Rows are retained
    -- (still queryable), only closed out.
    UPDATE public.node_fighter
       SET present = false,
           left_at = COALESCE(left_at, now()),
           updated_at = now()
     WHERE encounter_id = e.id AND present;

    UPDATE public.node_creature
       SET tank_fighter_id = NULL, updated_at = now()
     WHERE encounter_id = e.id AND tank_fighter_id IS NOT NULL;

    UPDATE public.node_intent
       SET status = 'rejected', reject_reason = 'stale_generation'
     WHERE encounter_id = e.id AND status = 'pending';

    UPDATE public.node_pending_event
       SET consumed_at = now(), consumed_tick = e.tick
     WHERE encounter_id = e.id AND consumed_at IS NULL;

    UPDATE public.node_encounter
       SET status           = 'active',
           next_due_at      = now(),
           claim_token      = NULL,
           claimed_tick     = NULL,
           claim_expires_at = NULL,
           intent_cutoff_seq = NULL,
           updated_at       = now()
     WHERE id = e.id
    RETURNING * INTO e;
  END IF;

  -- Seed only the currently living authoritative creature/spawn pairs. An older
  -- spawn_seq row is never revived: reward, death and participation identity
  -- stays separated by (creature_id, spawn_seq).
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
                        'entry_seq', v_seq, 'reentry', v_reentry,
                        'reactivated', v_reactivated),
     _request_id)
  RETURNING id INTO v_event_id;

  -- Invalidate any in-flight snapshot: the roster changed.
  UPDATE public.node_encounter
     SET state_version    = state_version + 1,
         claim_token      = NULL,
         claimed_tick     = NULL,
         claim_expires_at = NULL,
         updated_at       = now()
   WHERE id = e.id
  RETURNING state_version, tick INTO v_version, e.tick;

  RETURN jsonb_build_object('ok', true,
                            'kind', CASE WHEN v_reentry THEN 'reentered' ELSE 'entered' END,
                            'encounter_id', e.id,
                            'node_id', v_node,
                            'reactivated', v_reactivated,
                            'tick', e.tick,
                            'fighter_id', v_fighter,
                            'entry_seq', v_seq,
                            'event_id', v_event_id,
                            'state_version', v_version);
END;
$function$;