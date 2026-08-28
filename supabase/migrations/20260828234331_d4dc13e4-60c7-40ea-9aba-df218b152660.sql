-- ============================================================
-- B2. node_tick_claim / node_tick_commit
-- ============================================================

CREATE OR REPLACE FUNCTION public.node_tick_claim(
  _node_id uuid,
  _lease_ms integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e            public.node_encounter;
  v_candidate  integer;
  v_token      uuid;
  v_cutoff     bigint;
  v_snapshot   jsonb;
BEGIN
  SELECT * INTO e
  FROM public.node_encounter
  WHERE node_id = _node_id
    AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_claim', 'reason', 'locked_or_absent');
  END IF;

  IF e.next_due_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_due', 'next_due_at', e.next_due_at);
  END IF;

  IF e.claimed_tick IS NOT NULL AND e.claim_expires_at IS NOT NULL AND e.claim_expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_claim', 'reason', 'in_flight');
  END IF;

  v_candidate := e.tick + 1;
  v_token     := gen_random_uuid();

  SELECT max(seq) INTO v_cutoff
  FROM public.node_intent
  WHERE encounter_id = e.id AND status = 'pending';

  UPDATE public.node_encounter
     SET claimed_tick      = v_candidate,
         claim_token       = v_token,
         claim_expires_at  = now() + make_interval(secs => _lease_ms / 1000.0),
         intent_cutoff_seq = v_cutoff
   WHERE id = e.id;

  v_snapshot := jsonb_build_object(
    'encounter', jsonb_build_object(
      'id', e.id, 'node_id', e.node_id, 'tick', e.tick,
      'candidate_tick', v_candidate, 'state_version', e.state_version,
      'now', now()
    ),
    'creatures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', nc.id, 'creature_id', nc.creature_id, 'spawn_seq', nc.spawn_seq,
        'hp', nc.hp, 'is_alive', nc.is_alive, 'pending_action', nc.pending_action,
        'tank_fighter_id', nc.tank_fighter_id,
        'name', cr.name, 'level', cr.level, 'max_hp', cr.max_hp, 'ac', cr.ac,
        'stats', cr.stats, 'rarity', cr.rarity, 'is_humanoid', cr.is_humanoid,
        'is_aggressive', cr.is_aggressive,
        'boss_crit_flavors', cr.boss_crit_flavors, 'boss_death_cry', cr.boss_death_cry
      ) ORDER BY nc.created_at)
      FROM public.node_creature nc
      JOIN public.creatures cr ON cr.id = nc.creature_id
      WHERE nc.encounter_id = e.id
    ), '[]'::jsonb),
    'fighters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', nf.id, 'character_id', nf.character_id, 'entry_seq', nf.entry_seq,
        'present', nf.present, 'party_id_at_entry', nf.party_id_at_entry,
        'name', ch.name, 'class', ch.class, 'race', ch.race, 'level', ch.level,
        'hp', ch.hp, 'max_hp', ch.max_hp, 'cp', ch.cp, 'max_cp', ch.max_cp,
        'mp', ch.mp, 'max_mp', ch.max_mp, 'ac', ch.ac,
        'str', ch.str, 'dex', ch.dex, 'con', ch.con,
        'int', ch.int, 'wis', ch.wis, 'cha', ch.cha,
        'party_id', pm.party_id,
        'equipment', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'slot', ci.equipped_slot, 'item_id', ci.item_id,
            'inventory_id', ci.id, 'durability', ci.current_durability,
            'applied_gems', ci.applied_gems, 'stat_override', ci.stat_override,
            'crafted_level', ci.crafted_level
          ) ORDER BY ci.equipped_slot)
          FROM public.character_inventory ci
          WHERE ci.character_id = ch.id AND ci.equipped_slot IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY nf.entry_seq)
      FROM public.node_fighter nf
      JOIN public.characters ch ON ch.id = nf.character_id
      LEFT JOIN public.party_members pm ON pm.character_id = ch.id
      WHERE nf.encounter_id = e.id
    ), '[]'::jsonb),
    'effects', COALESCE((
      SELECT jsonb_agg(to_jsonb(ne) ORDER BY ne.created_at)
      FROM public.node_effect ne
      WHERE ne.encounter_id = e.id
    ), '[]'::jsonb),
    'intents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ni.id, 'seq', ni.seq, 'character_id', ni.character_id,
        'ability_key', ni.ability_key, 'target_creature_id', ni.target_creature_id
      ) ORDER BY ni.seq)
      FROM public.node_intent ni
      WHERE ni.encounter_id = e.id
        AND ni.status = 'pending'
        AND v_cutoff IS NOT NULL
        AND ni.seq <= v_cutoff
    ), '[]'::jsonb),
    'boss_abilities', COALESCE((
      SELECT jsonb_agg(to_jsonb(ba) ORDER BY ba.ability_key)
      FROM public.boss_ability ba
      WHERE ba.creature_id IN (
        SELECT creature_id FROM public.node_creature WHERE encounter_id = e.id
      )
    ), '[]'::jsonb)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'claimed',
    'encounter_id', e.id,
    'last_committed_tick', e.tick,
    'candidate_tick', v_candidate,
    'state_version', e.state_version,
    'claim_token', v_token,
    'intent_cutoff_seq', v_cutoff,
    'snapshot', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid, integer) TO service_role;


CREATE OR REPLACE FUNCTION public.node_tick_commit(
  _encounter_id uuid,
  _claim_token uuid,
  _candidate_tick integer,
  _expected_last_tick integer,
  _expected_state_version bigint,
  _intent_ids uuid[],
  _proposed jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e   public.node_encounter;
  rec jsonb;
BEGIN
  SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_claim', 'reason', 'no_encounter');
  END IF;

  IF e.tick >= _candidate_tick THEN
    RETURN jsonb_build_object('ok', true, 'kind', 'already_committed', 'tick', e.tick);
  END IF;

  IF e.claim_token IS DISTINCT FROM _claim_token
     OR e.claimed_tick IS DISTINCT FROM _candidate_tick
     OR e.claim_expires_at IS NULL
     OR e.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_claim');
  END IF;

  IF e.tick IS DISTINCT FROM _expected_last_tick
     OR e.state_version IS DISTINCT FROM _expected_state_version THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_snapshot');
  END IF;

  -- ---- characters: hp/cp/mp (clamped to maxima) ----
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'characters', '[]'::jsonb)) LOOP
    UPDATE public.characters c
       SET hp = LEAST(GREATEST(COALESCE((rec->>'hp')::int, c.hp), 0), c.max_hp),
           cp = LEAST(GREATEST(COALESCE((rec->>'cp')::int, c.cp), 0), c.max_cp),
           mp = LEAST(GREATEST(COALESCE((rec->>'mp')::int, c.mp), 0), c.max_mp),
           last_death_at = CASE WHEN COALESCE((rec->>'died')::boolean, false)
                                THEN now() ELSE c.last_death_at END
     WHERE c.id = (rec->>'id')::uuid;
  END LOOP;

  -- ---- creatures ----
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'creatures', '[]'::jsonb)) LOOP
    UPDATE public.node_creature nc
       SET hp              = GREATEST(COALESCE((rec->>'hp')::int, nc.hp), 0),
           is_alive        = COALESCE((rec->>'is_alive')::boolean, nc.is_alive) AND nc.is_alive,
           pending_action  = CASE WHEN rec ? 'pending_action'
                                  THEN NULLIF(rec->'pending_action', 'null'::jsonb)
                                  ELSE nc.pending_action END,
           tank_fighter_id = CASE WHEN rec ? 'tank_fighter_id'
                                  THEN NULLIF(rec->>'tank_fighter_id','')::uuid
                                  ELSE nc.tank_fighter_id END,
           last_damaged_at = CASE WHEN COALESCE((rec->>'damaged')::boolean, false)
                                  THEN now() ELSE nc.last_damaged_at END,
           died_at         = CASE WHEN nc.is_alive
                                   AND COALESCE((rec->>'is_alive')::boolean, true) = false
                                  THEN now() ELSE nc.died_at END
     WHERE nc.id = (rec->>'id')::uuid;

    -- mirror death onto the authored creature row (respawn scheduler reads it)
    UPDATE public.creatures cr
       SET hp = GREATEST(COALESCE((rec->>'hp')::int, cr.hp), 0),
           is_alive = COALESCE((rec->>'is_alive')::boolean, cr.is_alive) AND cr.is_alive,
           died_at = CASE WHEN cr.is_alive
                            AND COALESCE((rec->>'is_alive')::boolean, true) = false
                           THEN now() ELSE cr.died_at END,
           last_damaged_at = CASE WHEN COALESCE((rec->>'damaged')::boolean, false)
                                  THEN now() ELSE cr.last_damaged_at END
     WHERE cr.id = (rec->>'creature_id')::uuid
       AND cr.spawn_seq = (rec->>'spawn_seq')::int;
  END LOOP;

  -- ---- effects ----
  DELETE FROM public.node_effect
   WHERE id IN (
     SELECT (value #>> '{}')::uuid
     FROM jsonb_array_elements(COALESCE(_proposed->'effects_delete', '[]'::jsonb))
   );

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'effects_update', '[]'::jsonb)) LOOP
    UPDATE public.node_effect ne
       SET stacks          = COALESCE((rec->>'stacks')::int, ne.stacks),
           magnitude       = COALESCE((rec->>'magnitude')::numeric, ne.magnitude),
           expires_at      = CASE WHEN rec ? 'expires_at'
                                  THEN NULLIF(rec->>'expires_at','')::timestamptz
                                  ELSE ne.expires_at END,
           next_due_at     = CASE WHEN rec ? 'next_due_at'
                                  THEN NULLIF(rec->>'next_due_at','')::timestamptz
                                  ELSE ne.next_due_at END,
           last_pulse_tick = COALESCE((rec->>'last_pulse_tick')::int, ne.last_pulse_tick)
     WHERE ne.id = (rec->>'id')::uuid;
  END LOOP;

  INSERT INTO public.node_effect (
    encounter_id, kind, effect_type, ability_key,
    target_character_id, target_creature_id, source_character_id, source_creature_id,
    stacks, magnitude, config, expires_at, next_due_at, interval_ms,
    last_pulse_tick, is_reservation
  )
  SELECT _encounter_id,
         rec2->>'kind', rec2->>'effect_type', rec2->>'ability_key',
         NULLIF(rec2->>'target_character_id','')::uuid,
         NULLIF(rec2->>'target_creature_id','')::uuid,
         NULLIF(rec2->>'source_character_id','')::uuid,
         NULLIF(rec2->>'source_creature_id','')::uuid,
         COALESCE((rec2->>'stacks')::int, 1),
         NULLIF(rec2->>'magnitude','')::numeric,
         COALESCE(rec2->'config', '{}'::jsonb),
         NULLIF(rec2->>'expires_at','')::timestamptz,
         NULLIF(rec2->>'next_due_at','')::timestamptz,
         NULLIF(rec2->>'interval_ms','')::int,
         NULLIF(rec2->>'last_pulse_tick','')::int,
         COALESCE((rec2->>'is_reservation')::boolean, false)
  FROM jsonb_array_elements(COALESCE(_proposed->'effects_insert', '[]'::jsonb)) AS rec2;

  -- ---- fighters (presence transitions decided by the resolver) ----
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'fighters', '[]'::jsonb)) LOOP
    UPDATE public.node_fighter nf
       SET present = COALESCE((rec->>'present')::boolean, nf.present),
           left_at = CASE WHEN COALESCE((rec->>'present')::boolean, true) = false
                            AND nf.left_at IS NULL
                          THEN now() ELSE nf.left_at END
     WHERE nf.id = (rec->>'id')::uuid;
  END LOOP;

  -- ---- rewards: exactly once per (creature, spawn_seq, character) ----
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'rewards', '[]'::jsonb)) LOOP
    INSERT INTO public.node_reward_claim
      (creature_id, spawn_seq, character_id, xp_awarded, gold_awarded, is_killer)
    VALUES ((rec->>'creature_id')::uuid, (rec->>'spawn_seq')::int,
            (rec->>'character_id')::uuid,
            COALESCE((rec->>'xp_awarded')::int, 0),
            COALESCE((rec->>'gold_awarded')::int, 0),
            COALESCE((rec->>'is_killer')::boolean, false))
    ON CONFLICT (creature_id, spawn_seq, character_id) DO NOTHING;

    IF FOUND THEN
      PERFORM set_config('app.trusted_rpc', 'true', true);
      UPDATE public.characters
         SET xp   = xp   + COALESCE((rec->>'xp_awarded')::int, 0),
             gold = gold + COALESCE((rec->>'gold_awarded')::int, 0)
       WHERE id = (rec->>'character_id')::uuid;
    END IF;
  END LOOP;

  -- ---- committed event batch (unique per encounter/tick) ----
  INSERT INTO public.node_tick_batch (encounter_id, tick, events)
  VALUES (_encounter_id, _candidate_tick, COALESCE(_proposed->'events', '[]'::jsonb))
  ON CONFLICT (encounter_id, tick) DO NOTHING;

  -- ---- consume exactly the intents carried in the proposal ----
  IF _intent_ids IS NOT NULL AND array_length(_intent_ids, 1) > 0 THEN
    UPDATE public.node_intent
       SET status = 'consumed'
     WHERE id = ANY(_intent_ids) AND status = 'pending';
  END IF;

  -- ---- advance the committed tick ----
  UPDATE public.node_encounter
     SET tick             = _candidate_tick,
         state_version    = state_version + 1,
         claimed_tick     = NULL,
         claim_token      = NULL,
         claim_expires_at = NULL,
         next_due_at      = greatest(now(), next_due_at) + interval '2 seconds',
         status           = COALESCE(NULLIF(_proposed->>'status',''), status)
   WHERE id = _encounter_id;

  RETURN jsonb_build_object('ok', true, 'kind', 'committed', 'tick', _candidate_tick);
END;
$$;

REVOKE ALL ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) TO service_role;


-- Bump the encounter state version from any authoritative out-of-tick mutation.
CREATE OR REPLACE FUNCTION public.node_encounter_bump_version(_encounter_id uuid)
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.node_encounter
     SET state_version = state_version + 1
   WHERE id = _encounter_id
  RETURNING state_version;
$$;
REVOKE ALL ON FUNCTION public.node_encounter_bump_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_encounter_bump_version(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.node_encounter_bump_version(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_encounter_bump_version(uuid) TO service_role;