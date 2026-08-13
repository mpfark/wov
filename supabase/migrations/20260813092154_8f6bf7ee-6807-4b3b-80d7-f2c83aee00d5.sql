CREATE OR REPLACE FUNCTION public.commit_encounter_tick_v2(
  _encounter_id uuid,
  _tick bigint,
  _claim_token uuid,
  _batch_id uuid,
  _snapshot_version integer,
  _encounter_version integer,
  _snapshot_scope jsonb,
  _snapshot_digest jsonb,
  _proposed jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_digest jsonb;
  v_bad text;
  v_item jsonb;
  v_death uuid;
  v_session jsonb;
  v_session_skipped boolean := false;
  v_cap numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  -- ── refusals: every one of these happens BEFORE the first mutation ──
  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id FOR UPDATE;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'no_encounter');
  END IF;
  IF _snapshot_version <> 2
     OR COALESCE((_proposed->>'proposedTickVersion')::integer, 0) <> 2 THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'version_unsupported');
  END IF;
  IF v_enc.tick_number >= _tick THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'already_committed',
                              'tick_number', v_enc.tick_number);
  END IF;
  IF EXISTS (SELECT 1 FROM public.encounter_tick_batches
             WHERE encounter_id = _encounter_id AND tick_number = _tick) THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'duplicate_batch');
  END IF;
  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'stale_claim');
  END IF;
  IF v_enc.lease_until IS NULL OR v_enc.lease_until <= v_now THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'lease_expired');
  END IF;
  IF v_enc.version IS DISTINCT FROM _encounter_version THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'version_conflict');
  END IF;

  v_digest := public.encounter_state_digest(_encounter_id, COALESCE(_snapshot_scope, '{}'::jsonb));
  IF _snapshot_digest IS DISTINCT FROM v_digest THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'state_conflict',
                              'expected', _snapshot_digest, 'actual', v_digest);
  END IF;

  -- ── structural + bounds validation: reject, never normalise ──
  SELECT string_agg(msg, '; ') INTO v_bad FROM (
    SELECT 'unknown_character:' || x."characterId" AS msg
    FROM jsonb_to_recordset(COALESCE(_proposed->'characters', '[]'::jsonb))
         AS x("characterId" uuid, "hpBefore" integer, "hpAfter" integer,
              "cpAfter" integer, "mpAfter" integer)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_participants ep
                      WHERE ep.encounter_id = _encounter_id AND ep.character_id = x."characterId")
    UNION ALL
    SELECT 'character_bounds:' || x."characterId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'characters', '[]'::jsonb))
         AS x("characterId" uuid, "hpBefore" integer, "hpAfter" integer,
              "cpAfter" integer, "mpAfter" integer)
    JOIN public.characters c ON c.id = x."characterId"
    WHERE x."hpAfter" < 0 OR x."hpAfter" > c.max_hp
       OR x."cpAfter" < 0 OR x."cpAfter" > c.max_cp
       OR COALESCE(x."mpAfter", c.mp) < 0 OR COALESCE(x."mpAfter", c.mp) > c.max_mp
       OR x."hpBefore" IS DISTINCT FROM c.hp
    UNION ALL
    SELECT 'unknown_creature:' || y."creatureId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'creatures', '[]'::jsonb))
         AS y("creatureId" uuid, "spawnSeq" integer, "hpBefore" integer,
              "hpAfter" integer, killed boolean)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_creatures ec
                      WHERE ec.encounter_id = _encounter_id AND ec.creature_id = y."creatureId")
    UNION ALL
    SELECT 'creature_bounds:' || y."creatureId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'creatures', '[]'::jsonb))
         AS y("creatureId" uuid, "spawnSeq" integer, "hpBefore" integer,
              "hpAfter" integer, killed boolean)
    JOIN public.creatures cr ON cr.id = y."creatureId"
    WHERE y."hpAfter" < 0 OR y."hpAfter" > cr.max_hp
       OR y."hpBefore" IS DISTINCT FROM cr.hp
       OR y."spawnSeq" IS DISTINCT FROM cr.spawn_seq
    UNION ALL
    SELECT 'reward_bounds:' || r."characterId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'rewards', '[]'::jsonb))
         AS r("characterId" uuid, "deathId" uuid, xp integer, gold integer, renown integer,
              "levelAfter" integer)
    WHERE r.xp < 0 OR r.gold < 0 OR r.renown < 0
       OR COALESCE(r."levelAfter", 1) < 1 OR COALESCE(r."levelAfter", 1) > 42
       OR r."deathId" IS NULL
    UNION ALL
    SELECT 'unknown_reward_recipient:' || r."characterId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'rewards', '[]'::jsonb))
         AS r("characterId" uuid, "deathId" uuid)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_participants ep
                      WHERE ep.encounter_id = _encounter_id AND ep.character_id = r."characterId")
    UNION ALL
    SELECT 'durability:' || d."inventoryId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'durability', '[]'::jsonb))
         AS d("characterId" uuid, "inventoryId" uuid, "durabilityAfter" integer)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.character_inventory ci
      WHERE ci.id = d."inventoryId" AND ci.character_id = d."characterId"
        AND ci.equipped_slot IS NOT NULL)
      OR COALESCE(d."durabilityAfter", -1) < 0 OR COALESCE(d."durabilityAfter", -1) > 100
    UNION ALL
    SELECT 'action_not_pending:' || a.id
    FROM jsonb_to_recordset(COALESCE(_proposed->'actionTerminal', '[]'::jsonb))
         AS a(id uuid, status text, reason text)
    WHERE NOT EXISTS (SELECT 1 FROM public.combat_actions ca
                      WHERE ca.id = a.id AND ca.encounter_id = _encounter_id AND ca.status = 'pending')
       OR a.status NOT IN ('consumed', 'rejected')
    UNION ALL
    SELECT 'engagement_target:' || g."creatureId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'engagementsJoin', '[]'::jsonb))
         AS g("creatureId" uuid, "characterId" uuid)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_creatures ec
                      WHERE ec.encounter_id = _encounter_id AND ec.creature_id = g."creatureId")
       OR NOT EXISTS (SELECT 1 FROM public.encounter_participants ep
                      WHERE ep.encounter_id = _encounter_id AND ep.character_id = g."characterId")
    UNION ALL
    SELECT 'cast_creature:' || k."creatureId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'casts', '[]'::jsonb))
         AS k("creatureId" uuid, "abilityKey" text, phase text)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_creatures ec
                      WHERE ec.encounter_id = _encounter_id AND ec.creature_id = k."creatureId")
       OR k.phase NOT IN ('start', 'resolve', 'fizzle')
    UNION ALL
    SELECT 'stored_power:' || s."creatureId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'storedPower', '[]'::jsonb))
         AS s("creatureId" uuid, "currentAfter" integer, cap integer)
    WHERE s."currentAfter" < 0 OR (COALESCE(s.cap, 0) > 0 AND s."currentAfter" > s.cap)
    UNION ALL
    SELECT 'loot_item:' || l."itemId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'loot', '[]'::jsonb))
         AS l("deathId" uuid, "creatureId" uuid, mode text, "itemId" uuid,
              "lootTableId" uuid, "dropChance" numeric)
    WHERE l."itemId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.items i WHERE i.id = l."itemId")
    UNION ALL
    SELECT 'loot_chance:' || COALESCE(l."itemId"::text, l.mode)
    FROM jsonb_to_recordset(COALESCE(_proposed->'loot', '[]'::jsonb))
         AS l("deathId" uuid, mode text, "itemId" uuid, "dropChance" numeric)
    WHERE l."dropChance" IS NULL OR l."dropChance" < 0 OR l."dropChance" > 1
       OR l."deathId" IS NULL
    UNION ALL
    SELECT 'effect_target:' || COALESCE(e."targetId"::text, 'null')
    FROM jsonb_to_recordset(COALESCE(_proposed->'effectUpserts', '[]'::jsonb))
         AS e("targetId" uuid, "sourceId" uuid, "effectType" text)
    WHERE e."targetId" IS NULL OR e."sourceId" IS NULL OR e."effectType" IS NULL
       OR NOT (
         EXISTS (SELECT 1 FROM public.encounter_participants ep
                 WHERE ep.encounter_id = _encounter_id AND ep.character_id = e."targetId")
         OR EXISTS (SELECT 1 FROM public.encounter_creatures ec
                    WHERE ec.encounter_id = _encounter_id AND ec.creature_id = e."targetId"))
  ) AS problems;

  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'invalid_proposal', 'detail', v_bad);
  END IF;

  -- ══ mutations only from here. Any conflict must RAISE and roll back. ══

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'creatures', '[]'::jsonb)) LOOP
    UPDATE public.creatures
    SET hp = (v_item->>'hpAfter')::integer,
        is_alive = NOT COALESCE((v_item->>'killed')::boolean, false),
        died_at = CASE WHEN COALESCE((v_item->>'killed')::boolean, false) THEN now() ELSE died_at END,
        rewards_awarded_at = CASE WHEN COALESCE((v_item->>'killed')::boolean, false)
                                  THEN now() ELSE rewards_awarded_at END,
        last_damaged_at = now()
    WHERE id = (v_item->>'creatureId')::uuid;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'characters', '[]'::jsonb)) LOOP
    UPDATE public.characters
    SET hp = (v_item->>'hpAfter')::integer,
        cp = (v_item->>'cpAfter')::integer,
        mp = COALESCE((v_item->>'mpAfter')::integer, mp),
        reserved_buffs = jsonb_set(COALESCE(reserved_buffs, '{}'::jsonb), '{absorb_shield}',
                                   to_jsonb(COALESCE((v_item->>'absorbShieldAfter')::integer, 0)), true),
        stance_state = COALESCE(v_item->'stanceState', stance_state),
        updated_at = now()
    WHERE id = (v_item->>'characterId')::uuid;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'deaths', '[]'::jsonb)) LOOP
    UPDATE public.characters
    SET last_death_at = now(), last_death_log = v_item
    WHERE id = (v_item->>'characterId')::uuid;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'rewards', '[]'::jsonb)) LOOP
    v_death := (v_item->>'deathId')::uuid;
    INSERT INTO public.encounter_kill_awards
      (death_id, character_id, award_kind, encounter_id, creature_id, spawn_seq, tick_number)
    VALUES (v_death, (v_item->>'characterId')::uuid, 'reward', _encounter_id,
            (v_item->>'creatureId')::uuid, COALESCE((v_item->>'spawnSeq')::integer, 1), _tick)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      UPDATE public.characters
      SET xp = xp + COALESCE((v_item->>'xp')::integer, 0),
          gold = gold + COALESCE((v_item->>'gold')::integer, 0),
          rp_total_earned = COALESCE(rp_total_earned, 0) + COALESCE((v_item->>'renown')::integer, 0),
          level = COALESCE((v_item->>'levelAfter')::integer, level),
          max_hp = COALESCE((v_item->>'maxHpAfter')::integer, max_hp),
          max_cp = COALESCE((v_item->>'maxCpAfter')::integer, max_cp),
          max_mp = COALESCE((v_item->>'maxMpAfter')::integer, max_mp),
          unspent_stat_points = COALESCE((v_item->>'unspentStatPoints')::integer, unspent_stat_points),
          bhp = COALESCE((v_item->>'bhp')::integer, bhp)
      WHERE id = (v_item->>'characterId')::uuid;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'materials', '[]'::jsonb)) LOOP
    INSERT INTO public.encounter_kill_awards
      (death_id, character_id, award_kind, encounter_id, creature_id, spawn_seq, tick_number)
    VALUES ((v_item->>'deathId')::uuid, (v_item->>'characterId')::uuid,
            'material:' || (v_item->>'materialKey'), _encounter_id,
            (v_item->>'creatureId')::uuid, COALESCE((v_item->>'spawnSeq')::integer, 1), _tick)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public.add_material((v_item->>'characterId')::uuid, v_item->>'materialKey',
                                  COALESCE((v_item->>'quantity')::integer, 0));
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'gems', '[]'::jsonb)) LOOP
    INSERT INTO public.encounter_kill_awards
      (death_id, character_id, award_kind, encounter_id, creature_id, spawn_seq, tick_number)
    VALUES ((v_item->>'deathId')::uuid, (v_item->>'characterId')::uuid,
            'gem:' || (v_item->>'gemKey'), _encounter_id,
            (v_item->>'creatureId')::uuid, COALESCE((v_item->>'spawnSeq')::integer, 1), _tick)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public.add_material((v_item->>'characterId')::uuid, v_item->>'gemKey', 1);
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'bonds', '[]'::jsonb)) LOOP
    INSERT INTO public.encounter_kill_awards
      (death_id, character_id, award_kind, encounter_id, creature_id, spawn_seq, tick_number)
    VALUES ((v_item->>'deathId')::uuid, (v_item->>'characterId')::uuid, 'bond', _encounter_id,
            (v_item->>'creatureId')::uuid, COALESCE((v_item->>'spawnSeq')::integer, 1), _tick)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      PERFORM public.award_class_bond_for_kill(
        (v_item->>'characterId')::uuid,
        COALESCE((v_item->>'creatureLevel')::integer, 1),
        COALESCE((v_item->>'isBoss')::boolean, false));
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'loot', '[]'::jsonb)) LOOP
    INSERT INTO public.encounter_death_loot
      (death_id, encounter_id, creature_id, spawn_seq, tick_number, mode,
       loot_table_id, item_id, drop_chance, resolved)
    VALUES ((v_item->>'deathId')::uuid, _encounter_id, (v_item->>'creatureId')::uuid,
            COALESCE((v_item->>'spawnSeq')::integer, 1), _tick, v_item->>'mode',
            (v_item->>'lootTableId')::uuid, (v_item->>'itemId')::uuid,
            (v_item->>'dropChance')::numeric, (v_item->>'itemId') IS NOT NULL)
    ON CONFLICT (death_id) DO NOTHING;
    IF FOUND AND (v_item->>'itemId') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.items i
        WHERE i.id = (v_item->>'itemId')::uuid AND i.rarity = 'unique'::item_rarity
      ) OR NOT EXISTS (
        SELECT 1 FROM public.character_inventory ci WHERE ci.item_id = (v_item->>'itemId')::uuid
        UNION ALL
        SELECT 1 FROM public.node_ground_loot g WHERE g.item_id = (v_item->>'itemId')::uuid
        UNION ALL
        SELECT 1 FROM public.marketplace_listings m
        WHERE m.item_id = (v_item->>'itemId')::uuid AND m.status = 'active'
      ) THEN
        INSERT INTO public.node_ground_loot (node_id, item_id, creature_name)
        VALUES (v_enc.node_id, (v_item->>'itemId')::uuid, v_item->>'creatureName');
      END IF;
    END IF;
  END LOOP;

  IF _proposed ? 'effectDeleteTargetIds' THEN
    DELETE FROM public.active_effects
    WHERE target_id IN (SELECT (x)::uuid
                        FROM jsonb_array_elements_text(_proposed->'effectDeleteTargetIds') AS x);
  END IF;
  IF _proposed ? 'effectDeleteIds' THEN
    DELETE FROM public.active_effects
    WHERE id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(_proposed->'effectDeleteIds') AS x);
  END IF;
  INSERT INTO public.active_effects AS ae
    (node_id, target_id, source_id, effect_type, stacks, damage_per_tick,
     next_tick_at, expires_at, tick_rate_ms, source_ability_key)
  SELECT v_enc.node_id, (e->>'targetId')::uuid, (e->>'sourceId')::uuid, e->>'effectType',
         COALESCE((e->>'stacks')::integer, 1), COALESCE((e->>'amountPerTick')::integer, 0),
         (e->>'lastTickAtMs')::bigint, COALESCE((e->>'expiresAtMs')::bigint, 0),
         COALESCE((e->>'intervalMs')::integer, 2000), e->>'sourceAbilityKey'
  FROM jsonb_array_elements(COALESCE(_proposed->'effectUpserts', '[]'::jsonb)) AS e
  ON CONFLICT (source_id, target_id, effect_type) DO UPDATE
    SET stacks = EXCLUDED.stacks, damage_per_tick = EXCLUDED.damage_per_tick,
        expires_at = EXCLUDED.expires_at, next_tick_at = EXCLUDED.next_tick_at,
        tick_rate_ms = EXCLUDED.tick_rate_ms;

  DELETE FROM public.encounter_engagements
  WHERE encounter_id = _encounter_id
    AND creature_id IN (SELECT (x)::uuid FROM jsonb_array_elements_text(
      COALESCE(_proposed->'engagementsPurgeCreatureIds', '[]'::jsonb)) AS x);

  INSERT INTO public.encounter_engagements (encounter_id, creature_id, character_id, last_action_at)
  SELECT _encounter_id, (g->>'creatureId')::uuid, (g->>'characterId')::uuid, now()
  FROM jsonb_array_elements(COALESCE(_proposed->'engagementsJoin', '[]'::jsonb)) AS g
  ON CONFLICT (encounter_id, creature_id, character_id) DO UPDATE SET last_action_at = now();

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'durability', '[]'::jsonb)) LOOP
    UPDATE public.character_inventory
    SET current_durability = (v_item->>'durabilityAfter')::integer
    WHERE id = (v_item->>'inventoryId')::uuid;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'casts', '[]'::jsonb)) LOOP
    IF v_item->>'phase' = 'start' THEN
      INSERT INTO public.encounter_cast_events
        (encounter_id, creature_id, node_id, cast_key, ability_key, payload, started_at, expires_at)
      VALUES (_encounter_id, (v_item->>'creatureId')::uuid, v_enc.node_id,
              v_item->>'abilityKey', v_item->>'abilityKey', COALESCE(v_item->'payload', '{}'::jsonb),
              now(), to_timestamp(COALESCE((v_item->>'resolvesAtMs')::bigint, v_now) / 1000.0));
    ELSE
      UPDATE public.encounter_cast_events
      SET resolved_at = now(), payload = COALESCE(v_item->'payload', payload)
      WHERE encounter_id = _encounter_id
        AND creature_id = (v_item->>'creatureId')::uuid
        AND resolved_at IS NULL;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'storedPower', '[]'::jsonb)) LOOP
    v_cap := NULLIF((v_item->>'cap')::numeric, 0);
    UPDATE public.encounters
    SET stored_power = (v_item->>'currentAfter')::integer,
        stored_power_cap = COALESCE(v_cap::integer, stored_power_cap),
        stored_power_source_id = COALESCE((v_item->>'creatureId')::uuid, stored_power_source_id)
    WHERE id = _encounter_id;
  END LOOP;

  INSERT INTO public.encounter_contributions
    (encounter_id, character_id, damage_dealt, healing_done, first_hit_at, last_hit_at)
  SELECT _encounter_id, (c->>'characterId')::uuid,
         COALESCE((c->>'damageDealt')::integer, 0), COALESCE((c->>'healingDone')::integer, 0),
         now(), now()
  FROM jsonb_array_elements(COALESCE(_proposed->'contributions', '[]'::jsonb)) AS c
  ON CONFLICT (encounter_id, character_id) DO UPDATE
    SET damage_dealt = public.encounter_contributions.damage_dealt + EXCLUDED.damage_dealt,
        healing_done = public.encounter_contributions.healing_done + EXCLUDED.healing_done,
        last_hit_at = now();

  -- session: derived presence only. Never last_tick_at, never cadence.
  v_session := _proposed->'session';
  IF v_session IS NOT NULL AND (v_session->>'sessionId') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.combat_sessions
                   WHERE id = (v_session->>'sessionId')::uuid) THEN
      v_session_skipped := true;
    ELSIF COALESCE((v_session->>'ended')::boolean, false) THEN
      DELETE FROM public.combat_sessions WHERE id = (v_session->>'sessionId')::uuid;
    ELSE
      UPDATE public.combat_sessions
      SET engaged_creature_ids = COALESCE(
            (SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
               COALESCE(v_session->'engagedCreatureIds', '[]'::jsonb)) AS x),
            engaged_creature_ids)
      WHERE id = (v_session->>'sessionId')::uuid;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'actionTerminal', '[]'::jsonb)) LOOP
    UPDATE public.combat_actions
    SET status = v_item->>'status',
        consumed_tick = _tick,
        reject_reason = CASE WHEN v_item->>'status' = 'rejected'
                             THEN COALESCE(v_item->>'reason', 'rejected') ELSE NULL END,
        updated_at = now()
    WHERE id = (v_item->>'id')::uuid AND status = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'action_race:%', v_item->>'id';
    END IF;
  END LOOP;

  UPDATE public.encounters
  SET tick_number = _tick,
      tick_at = v_now,
      tick_state = 'idle',
      resolving_tick = NULL,
      claim_token = NULL,
      resolver_id = NULL,
      lease_until = NULL,
      attempt = 0,
      version = version + 1,
      last_activity_at = now()
  WHERE id = _encounter_id;

  -- uniqueness fence: no ON CONFLICT. A duplicate raises 23505 and rolls back
  -- every mutation above. No pruning happens here.
  INSERT INTO public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
  VALUES (_encounter_id, _tick, _batch_id, jsonb_build_object(
    'v', 2, 'tick', _tick, 'batch_id', _batch_id, 'mode', _proposed->>'mode',
    'events', COALESCE(_proposed->'events', '[]'::jsonb),
    'characters', COALESCE(_proposed->'characters', '[]'::jsonb),
    'creatures', COALESCE(_proposed->'creatures', '[]'::jsonb),
    'deaths', COALESCE(_proposed->'deaths', '[]'::jsonb),
    'kills', COALESCE(_proposed->'kills', '[]'::jsonb)));

  RETURN jsonb_build_object(
    'committed', true, 'tick', _tick, 'batch_id', _batch_id, 'committed_at', v_now,
    'applied', jsonb_build_object('session_skipped', v_session_skipped));
END;
$$;

REVOKE ALL ON FUNCTION public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb) TO service_role;