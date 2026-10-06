CREATE OR REPLACE FUNCTION public.node_tick_commit_without_bounded_failure(_encounter_id uuid, _claim_token uuid, _candidate_tick integer, _expected_last_tick integer, _expected_state_version bigint, _intent_ids uuid[], _proposed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e             public.node_encounter;
  rec           jsonb;
  v_bad         text;
  v_pending_ids uuid[];
  v_events      jsonb;
  v_delivered   jsonb;
BEGIN
  SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_claim', 'reason', 'no_encounter');
  END IF;


  IF e.test_arena_id IS NOT NULL AND (jsonb_array_length(COALESCE(_proposed->'rewards','[]'::jsonb))<>0 OR jsonb_array_length(COALESCE(_proposed->'loot','[]'::jsonb))<>0 OR jsonb_array_length(COALESCE(_proposed->'durability','[]'::jsonb))<>0) THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_proposal','reason','test_rewards_forbidden');
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

  v_pending_ids := ARRAY(
    SELECT (value #>> '{}')::uuid
    FROM jsonb_array_elements(COALESCE(_proposed->'pending_event_ids', '[]'::jsonb))
  );

  -- ---------- encounter-scope validation (no mutation yet) ----------
  -- characters: must be a fighter of THIS encounter
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (SELECT (value->>'id')::uuid AS id
        FROM jsonb_array_elements(COALESCE(_proposed->'characters','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                    WHERE nf.encounter_id = _encounter_id AND nf.character_id = x.id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'characters', 'ids', v_bad);
  END IF;

  -- creatures: node_creature row must belong to this encounter and match
  -- the declared (creature_id, spawn_seq) identity.
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (SELECT (value->>'id')::uuid AS id,
               (value->>'creature_id')::uuid AS creature_id,
               (value->>'spawn_seq')::int AS spawn_seq
        FROM jsonb_array_elements(COALESCE(_proposed->'creatures','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_creature nc
                    WHERE nc.id = x.id AND nc.encounter_id = _encounter_id
                      AND nc.creature_id = x.creature_id
                      AND nc.spawn_seq = x.spawn_seq);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'creatures', 'ids', v_bad);
  END IF;

  -- effects (update + delete)
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (
    SELECT (value->>'id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(_proposed->'effects_update','[]'::jsonb))
    UNION ALL
    SELECT (value #>> '{}')::uuid
    FROM jsonb_array_elements(COALESCE(_proposed->'effects_delete','[]'::jsonb))
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_effect ne
                    WHERE ne.id = x.id AND ne.encounter_id = _encounter_id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'effects', 'ids', v_bad);
  END IF;

  -- fighters
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (SELECT (value->>'id')::uuid AS id
        FROM jsonb_array_elements(COALESCE(_proposed->'fighters','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                    WHERE nf.id = x.id AND nf.encounter_id = _encounter_id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'fighters', 'ids', v_bad);
  END IF;

  -- participation upserts must name a creature spawn of this encounter and
  -- a character that entered this encounter. Validated BEFORE rewards, so a
  -- same-tick proposal can only ever authorize its own exact identity.
  SELECT string_agg(DISTINCT x.character_id::text, ',') INTO v_bad
  FROM (SELECT (value->>'creature_id')::uuid AS creature_id,
               (value->>'spawn_seq')::int AS spawn_seq,
               (value->>'character_id')::uuid AS character_id
        FROM jsonb_array_elements(COALESCE(_proposed->'participation','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_creature nc
                    WHERE nc.encounter_id = _encounter_id
                      AND nc.creature_id = x.creature_id
                      AND nc.spawn_seq = x.spawn_seq)
     OR NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                    WHERE nf.encounter_id = _encounter_id
                      AND nf.character_id = x.character_id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'participation', 'ids', v_bad);
  END IF;

  -- rewards: the creature spawn must belong to this encounter, and the
  -- character must be qualified for EXACTLY that spawn -- either durably in
  -- node_participation, or by a participation row proposed in this same tick
  -- (validated immediately above). Party membership and node presence never
  -- qualify anyone.
  SELECT string_agg(DISTINCT x.character_id::text, ',') INTO v_bad
  FROM (SELECT (value->>'creature_id')::uuid AS creature_id,
               (value->>'spawn_seq')::int AS spawn_seq,
               (value->>'character_id')::uuid AS character_id
        FROM jsonb_array_elements(COALESCE(_proposed->'rewards','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_creature nc
                    WHERE nc.encounter_id = _encounter_id
                      AND nc.creature_id = x.creature_id
                      AND nc.spawn_seq = x.spawn_seq)
     OR NOT (
          EXISTS (SELECT 1 FROM public.node_participation np
                  WHERE np.encounter_id = _encounter_id
                    AND np.creature_id = x.creature_id
                    AND np.spawn_seq = x.spawn_seq
                    AND np.character_id = x.character_id
                    AND np.qualification = 'qualified')
          OR EXISTS (SELECT 1
                     FROM jsonb_array_elements(
                            COALESCE(_proposed->'participation','[]'::jsonb)) p
                     WHERE (p.value->>'creature_id')::uuid = x.creature_id
                       AND (p.value->>'spawn_seq')::int = x.spawn_seq
                       AND (p.value->>'character_id')::uuid = x.character_id
                       AND COALESCE(NULLIF(p.value->>'qualification',''), 'qualified')
                           = 'qualified')
        );
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'rewards', 'ids', v_bad);
  END IF;


  SELECT string_agg(DISTINCT x.node_creature_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'node_creature_id')::uuid node_creature_id,(value->>'creature_id')::uuid creature_id,
      (value->>'spawn_seq')::int spawn_seq,(value->>'character_id')::uuid character_id,
      (value->>'xp_awarded')::int xp_awarded,(value->>'gold_awarded')::int gold_awarded
    FROM jsonb_array_elements(COALESCE(_proposed->'rewards','[]'::jsonb))) x
  WHERE x.xp_awarded<0 OR x.gold_awarded<0
    OR NOT EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.id=x.node_creature_id AND nc.encounter_id=_encounter_id AND nc.creature_id=x.creature_id AND nc.spawn_seq=x.spawn_seq)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'creatures','[]'::jsonb)) c WHERE (c->>'id')::uuid=x.node_creature_id AND (c->>'creature_id')::uuid=x.creature_id AND (c->>'spawn_seq')::int=x.spawn_seq AND (c->>'is_alive')::boolean=false);
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','foreign_reference','relation','reward_death','ids',v_bad); END IF;

  -- Loot is fenced to the exact proposed death identity. Items may be referenced
  -- only for a dropped result; their generation properties were frozen in claim.
  SELECT string_agg(DISTINCT x.node_creature_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'node_creature_id')::uuid node_creature_id,(value->>'creature_id')::uuid creature_id,
      (value->>'spawn_seq')::int spawn_seq,NULLIF(value->>'item_id','')::uuid item_id,value->>'outcome' outcome
    FROM jsonb_array_elements(COALESCE(_proposed->'loot','[]'::jsonb))) x
  WHERE NOT EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.id=x.node_creature_id AND nc.encounter_id=_encounter_id AND nc.creature_id=x.creature_id AND nc.spawn_seq=x.spawn_seq)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'creatures','[]'::jsonb)) c WHERE (c->>'id')::uuid=x.node_creature_id AND (c->>'creature_id')::uuid=x.creature_id AND (c->>'spawn_seq')::int=x.spawn_seq AND (c->>'is_alive')::boolean=false)
    OR ((x.outcome='dropped') IS DISTINCT FROM (x.item_id IS NOT NULL))
    OR (x.item_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.items i WHERE i.id=x.item_id));
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','foreign_reference','relation','loot','ids',v_bad); END IF;


  -- A stale repair, transfer, delete, equip/unequip, break, or fighter entry
  -- generation rejects the whole transaction before any combat mutation.
  SELECT string_agg(x.inventory_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'inventory_id')::uuid inventory_id,(value->>'character_id')::uuid character_id,
      (value->>'fighter_id')::uuid fighter_id,(value->>'entry_seq')::int entry_seq,
      (value->>'item_id')::uuid item_id,value->>'slot' slot,(value->>'durability')::int durability,
      value->'applied_gems' applied_gems,NULLIF(value->'stat_override','null'::jsonb) stat_override,(value->>'crafted_level')::int crafted_level,
      (value->>'item_present')::boolean item_present,value->>'item_type' item_type,value->>'weapon_tag' weapon_tag,
      (value->>'hands')::int hands,(value->>'item_level')::int item_level,value->>'rarity' rarity,
      (value->>'max_durability')::int max_durability,value->'base_stats' base_stats,value->'procs' procs
    FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence','[]'::jsonb))) x
  WHERE NOT x.item_present
    OR NOT EXISTS(SELECT 1 FROM public.node_fighter nf WHERE nf.id=x.fighter_id AND nf.encounter_id=_encounter_id
      AND nf.character_id=x.character_id AND nf.entry_seq=x.entry_seq AND nf.present)
    OR NOT EXISTS(SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
      WHERE ci.id=x.inventory_id AND ci.character_id=x.character_id AND ci.item_id=x.item_id
        AND ci.equipped_slot::text=x.slot AND ci.current_durability=x.durability
        AND ci.applied_gems=x.applied_gems AND ci.stat_override IS NOT DISTINCT FROM x.stat_override
        AND ci.crafted_level IS NOT DISTINCT FROM x.crafted_level AND i.item_type::text=x.item_type
        AND i.weapon_tag IS NOT DISTINCT FROM x.weapon_tag AND i.hands IS NOT DISTINCT FROM x.hands
        AND i.level IS NOT DISTINCT FROM x.item_level AND i.rarity::text=x.rarity
        AND i.max_durability=x.max_durability AND COALESCE(i.stats,'{}'::jsonb)=x.base_stats
        AND COALESCE(i.procs,'[]'::jsonb)=x.procs);
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','stale_equipment','ids',v_bad); END IF;

  -- There must be no additional equipped row omitted from the claimed fence.
  IF EXISTS(SELECT 1 FROM public.node_fighter nf JOIN public.character_inventory ci ON ci.character_id=nf.character_id
    WHERE nf.encounter_id=_encounter_id AND nf.present AND ci.equipped_slot IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence','[]'::jsonb)) x
        WHERE (x->>'inventory_id')::uuid=ci.id)) THEN
    RETURN jsonb_build_object('ok',false,'kind','stale_equipment','ids','loadout_changed');
  END IF;

  SELECT string_agg(x.inventory_id::text, ',') INTO v_bad FROM (
    SELECT (value->>'inventory_id')::uuid inventory_id,(value->>'character_id')::uuid character_id,
      (value->>'fighter_id')::uuid fighter_id,(value->>'entry_seq')::int entry_seq,
      (value->>'item_id')::uuid item_id,value->>'slot' slot,value->>'rarity' rarity,
      (value->>'durability_before')::int durability_before,(value->>'durability_after')::int durability_after
    FROM jsonb_array_elements(COALESCE(_proposed->'durability','[]'::jsonb))) x
  WHERE x.durability_before<1 OR x.durability_after<>GREATEST(0,x.durability_before-1)
    OR NOT EXISTS(SELECT 1 FROM public.node_fighter nf WHERE nf.id=x.fighter_id AND nf.encounter_id=_encounter_id
      AND nf.character_id=x.character_id AND nf.entry_seq=x.entry_seq AND nf.present)
    OR NOT EXISTS(SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
      WHERE ci.id=x.inventory_id AND ci.character_id=x.character_id AND ci.item_id=x.item_id
        AND ci.equipped_slot::text=x.slot AND ci.current_durability=x.durability_before
        AND i.rarity::text=x.rarity AND i.max_durability>=x.durability_before);
  IF v_bad IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','stale_equipment','ids',v_bad); END IF;

  -- intents must be pending intents of this encounter, within the cutoff
  SELECT string_agg(DISTINCT t.id::text, ',') INTO v_bad
  FROM unnest(COALESCE(_intent_ids, ARRAY[]::uuid[])) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.node_intent ni
                    WHERE ni.id = t.id AND ni.encounter_id = _encounter_id
                      AND ni.status = 'pending'
                      AND (e.intent_cutoff_seq IS NULL OR ni.seq <= e.intent_cutoff_seq));
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'intents', 'ids', v_bad);
  END IF;

  -- pending events must be unconsumed events of this encounter
  SELECT string_agg(DISTINCT t.id::text, ',') INTO v_bad
  FROM unnest(v_pending_ids) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.node_pending_event pe
                    WHERE pe.id = t.id AND pe.encounter_id = _encounter_id
                      AND pe.consumed_at IS NULL);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'pending_events', 'ids', v_bad);
  END IF;


  -- departure proposals are locked and fully fenced before any mutation.
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) LOOP
    PERFORM 1 FROM public.combat2_departure_request dr
     WHERE dr.request_id=(rec->>'request_id')::uuid AND dr.status='queued'
       AND dr.encounter_id=_encounter_id AND dr.fighter_id=(rec->>'fighter_id')::uuid
       AND dr.fighter_entry_seq=(rec->>'fighter_entry_seq')::bigint
       AND dr.origin_node_id=(rec->>'origin_node_id')::uuid
       AND dr.destination_node_id=(rec->>'destination_node_id')::uuid
       AND dr.cost=(rec->>'cost')::integer AND dr.resource_kind='mp'
     FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.node_fighter nf JOIN public.characters c ON c.id=nf.character_id
       WHERE nf.id=(rec->>'fighter_id')::uuid AND nf.encounter_id=_encounter_id
         AND nf.entry_seq=(rec->>'fighter_entry_seq')::bigint AND nf.present
         AND nf.arrival_group_id IS NOT DISTINCT FROM (
           SELECT dr.arrival_group_id FROM public.combat2_departure_request dr
            WHERE dr.request_id=(rec->>'request_id')::uuid)
         AND c.current_node_id=(rec->>'origin_node_id')::uuid
    ) THEN RETURN jsonb_build_object('ok',false,'kind','stale_departure'); END IF;
    IF rec->>'outcome' NOT IN ('moved','dead') THEN
      RETURN jsonb_build_object('ok',false,'kind','malformed_departure');
    END IF;
  END LOOP;


  -- Deterministic encounter -> character lock order for all economic mutations.
  PERFORM 1 FROM public.characters ch WHERE ch.id IN (SELECT (value->>'character_id')::uuid FROM jsonb_array_elements(COALESCE(_proposed->'rewards','[]'::jsonb)) UNION SELECT (value->>'character_id')::uuid FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence','[]'::jsonb))) ORDER BY ch.id FOR UPDATE; PERFORM 1 FROM public.character_inventory ci WHERE ci.id IN (SELECT (value->>'inventory_id')::uuid FROM jsonb_array_elements(COALESCE(_proposed->'equipment_fence','[]'::jsonb))) ORDER BY ci.id FOR UPDATE;

  -- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'characters', '[]'::jsonb)) LOOP
    UPDATE public.characters c
       SET hp = LEAST(GREATEST(COALESCE((rec->>'hp')::int, c.hp), 0), c.max_hp),
           cp = LEAST(GREATEST(COALESCE((rec->>'cp')::int, c.cp), 0), c.max_cp),
           mp = LEAST(GREATEST(COALESCE((rec->>'mp')::int, c.mp), 0), c.max_mp),
           last_death_at = CASE WHEN COALESCE((rec->>'died')::boolean, false)
                                THEN now() ELSE c.last_death_at END
     WHERE c.id = (rec->>'id')::uuid
       AND EXISTS (SELECT 1 FROM public.node_fighter nf
                   WHERE nf.encounter_id = _encounter_id AND nf.character_id = c.id);
  END LOOP;

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
     WHERE nc.id = (rec->>'id')::uuid
       AND nc.encounter_id = _encounter_id;

    -- mirror death onto the authored creature row, fenced by spawn_seq
    UPDATE public.creatures cr
       SET hp = GREATEST(COALESCE((rec->>'hp')::int, cr.hp), 0),
           is_alive = COALESCE((rec->>'is_alive')::boolean, cr.is_alive) AND cr.is_alive,
           died_at = CASE WHEN cr.is_alive
                            AND COALESCE((rec->>'is_alive')::boolean, true) = false
                           THEN now() ELSE cr.died_at END,
           last_damaged_at = CASE WHEN COALESCE((rec->>'damaged')::boolean, false)
                                  THEN now() ELSE cr.last_damaged_at END
     WHERE cr.id = (rec->>'creature_id')::uuid
       AND cr.spawn_seq = (rec->>'spawn_seq')::int
       AND EXISTS (SELECT 1 FROM public.node_creature nc2
                   WHERE nc2.encounter_id = _encounter_id
                     AND nc2.creature_id = cr.id
                     AND nc2.spawn_seq = cr.spawn_seq);
  END LOOP;

  DELETE FROM public.node_effect
   WHERE encounter_id = _encounter_id
     AND id IN (
       SELECT (value #>> '{}')::uuid
       FROM jsonb_array_elements(COALESCE(_proposed->'effects_delete', '[]'::jsonb))
     );

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'effects_update', '[]'::jsonb)) LOOP
    UPDATE public.node_effect ne
       SET config          = CASE WHEN rec ? 'config' THEN rec->'config' ELSE ne.config END,
           stacks          = COALESCE((rec->>'stacks')::int, ne.stacks),
           magnitude       = COALESCE((rec->>'magnitude')::numeric, ne.magnitude),
           expires_at      = CASE WHEN rec ? 'expires_at'
                                  THEN NULLIF(rec->>'expires_at','')::timestamptz
                                  ELSE ne.expires_at END,
           next_due_at     = CASE WHEN rec ? 'next_due_at'
                                  THEN NULLIF(rec->>'next_due_at','')::timestamptz
                                  ELSE ne.next_due_at END,
           last_pulse_tick = COALESCE((rec->>'last_pulse_tick')::int, ne.last_pulse_tick)
     WHERE ne.id = (rec->>'id')::uuid
       AND ne.encounter_id = _encounter_id;
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

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'fighters', '[]'::jsonb)) LOOP
    UPDATE public.node_fighter nf
       SET present = COALESCE((rec->>'present')::boolean, nf.present),
           left_at = CASE WHEN COALESCE((rec->>'present')::boolean, true) = false
                            AND nf.left_at IS NULL
                          THEN now() ELSE nf.left_at END
     WHERE nf.id = (rec->>'id')::uuid
       AND nf.encounter_id = _encounter_id;
  END LOOP;

  -- participation: durable per-spawn qualification, written by the tick only
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'participation', '[]'::jsonb)) LOOP
    INSERT INTO public.node_participation
      (encounter_id, creature_id, spawn_seq, character_id,
       qualification, qualified_by, party_id_at_qualification)
    VALUES (_encounter_id, (rec->>'creature_id')::uuid, (rec->>'spawn_seq')::int,
            (rec->>'character_id')::uuid,
            COALESCE(NULLIF(rec->>'qualification',''), 'qualified'),
            rec->>'qualified_by',
            NULLIF(rec->>'party_id_at_qualification','')::uuid)
    ON CONFLICT (encounter_id, creature_id, spawn_seq, character_id)
    DO UPDATE SET last_at = now(),
                  qualification = COALESCE(NULLIF(EXCLUDED.qualification,''),
                                           node_participation.qualification);
  END LOOP;

  -- rewards: exactly once per (creature, spawn_seq, character)
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'rewards', '[]'::jsonb)) LOOP
    INSERT INTO public.node_reward_claim
      (encounter_id, node_creature_id, creature_id, spawn_seq, character_id, xp_awarded, gold_awarded, is_killer)
    VALUES (_encounter_id, (rec->>'node_creature_id')::uuid, (rec->>'creature_id')::uuid, (rec->>'spawn_seq')::int,
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


  -- One durable outcome per death/category; dropped templates become ordinary
  -- node ground loot in the same transaction. Capacity is enforced on pickup,
  -- so a full bag cannot destroy an earned drop.
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'loot','[]'::jsonb)) LOOP
    INSERT INTO public.node_death_loot(encounter_id,node_creature_id,creature_id,spawn_seq,loot_key,item_id,mode,outcome)
    VALUES(_encounter_id,(rec->>'node_creature_id')::uuid,(rec->>'creature_id')::uuid,(rec->>'spawn_seq')::int,rec->>'loot_key',NULLIF(rec->>'item_id','')::uuid,rec->>'mode',rec->>'outcome')
    ON CONFLICT(encounter_id,node_creature_id,spawn_seq,loot_key) DO NOTHING;
    IF FOUND AND rec->>'outcome'='dropped' THEN
      WITH inserted AS (INSERT INTO public.node_ground_loot(node_id,item_id,creature_name)
        VALUES(e.node_id,(rec->>'item_id')::uuid,rec->>'creature_name') RETURNING id)
      UPDATE public.node_death_loot SET ground_loot_id=(SELECT id FROM inserted)
      WHERE encounter_id=_encounter_id AND node_creature_id=(rec->>'node_creature_id')::uuid
        AND spawn_seq=(rec->>'spawn_seq')::int AND loot_key=rec->>'loot_key';
    END IF;
  END LOOP;


  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'durability','[]'::jsonb)) LOOP
    IF (rec->>'durability_after')::int=0 AND rec->>'rarity'='unique' THEN
      DELETE FROM public.character_inventory WHERE id=(rec->>'inventory_id')::uuid
        AND character_id=(rec->>'character_id')::uuid AND current_durability=(rec->>'durability_before')::int;
    ELSIF (rec->>'durability_after')::int=0 THEN
      UPDATE public.character_inventory SET current_durability=0,equipped_slot=NULL
      WHERE id=(rec->>'inventory_id')::uuid AND character_id=(rec->>'character_id')::uuid
        AND current_durability=(rec->>'durability_before')::int;
    ELSE
      UPDATE public.character_inventory SET current_durability=(rec->>'durability_after')::int
      WHERE id=(rec->>'inventory_id')::uuid AND character_id=(rec->>'character_id')::uuid
        AND current_durability=(rec->>'durability_before')::int;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'combat2 durability fence changed after validation'; END IF;
  END LOOP;

  -- ---- committed batch: exactly one per (encounter_id, tick). Pending
  -- events are folded into THIS batch, never delivered as their own. ----
  v_events := COALESCE(_proposed->'events', '[]'::jsonb);
  IF array_length(v_pending_ids, 1) > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', 'pending_event', 'eventType', pe.event_type,
             'pendingEventId', pe.id,
             'actorCharacterId', pe.actor_character_id,
             'actorCreatureId', pe.actor_creature_id,
             'targetCharacterId', pe.target_character_id,
             'targetCreatureId', pe.target_creature_id,
             'payload', pe.payload, 'occurredAt', pe.occurred_at
           ) ORDER BY pe.occurred_at, pe.id), '[]'::jsonb)
      INTO v_delivered
      FROM public.node_pending_event pe
     WHERE pe.encounter_id = _encounter_id
       AND pe.id = ANY(v_pending_ids)
       AND pe.consumed_at IS NULL;
    v_events := v_events || v_delivered;
  END IF;

  INSERT INTO public.node_tick_batch (encounter_id, tick, events)
  VALUES (_encounter_id, _candidate_tick, v_events)
  ON CONFLICT (encounter_id, tick) DO NOTHING;

  -- exactly-once consumption, inside the same successful commit
  IF array_length(v_pending_ids, 1) > 0 THEN
    UPDATE public.node_pending_event
       SET consumed_at = now(), consumed_tick = _candidate_tick
     WHERE encounter_id = _encounter_id
       AND id = ANY(v_pending_ids)
       AND consumed_at IS NULL;
  END IF;

  IF _intent_ids IS NOT NULL AND array_length(_intent_ids, 1) > 0 THEN
    UPDATE public.node_intent
       SET status = 'consumed'
     WHERE id = ANY(_intent_ids)
       AND encounter_id = _encounter_id
       AND status = 'pending';
  END IF;


  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) LOOP
    IF rec->>'outcome'='moved' THEN
      PERFORM set_config('app.combat2_depart_authorized','true',true);
      UPDATE public.characters SET current_node_id=(rec->>'destination_node_id')::uuid,
        mp=mp-(rec->>'cost')::integer
       WHERE id=(SELECT character_id FROM public.combat2_departure_request WHERE request_id=(rec->>'request_id')::uuid)
         AND current_node_id=(rec->>'origin_node_id')::uuid AND hp>0 AND mp>=(rec->>'cost')::integer;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='combat2_depart_fence_failed'; END IF;
      UPDATE public.combat2_departure_request SET status='moved',resolved_tick=_candidate_tick,resolved_at=now()
       WHERE request_id=(rec->>'request_id')::uuid AND status='queued';
    ELSE
      UPDATE public.combat2_departure_request SET status='dead',resolved_tick=_candidate_tick,resolved_at=now()
       WHERE request_id=(rec->>'request_id')::uuid AND status='queued';
    END IF;
  END LOOP;

  UPDATE public.node_encounter
     SET tick             = _candidate_tick,
         state_version    = state_version + 1,
         claimed_tick     = NULL,
         claim_token      = NULL,
         claim_expires_at = NULL,
         next_due_at = next_due_at
         + (floor(greatest(0::numeric, extract(epoch from (now() - next_due_at))) / 2)::bigint + 1)
           * interval '2 seconds',
         status           = COALESCE(NULLIF(_proposed->>'status',''), status)
   WHERE id = _encounter_id;

  RETURN jsonb_build_object('ok', true, 'kind', 'committed', 'tick', _candidate_tick);
END;
$function$
