CREATE OR REPLACE FUNCTION public.c2_harness_run()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  t jsonb := '[]'::jsonb;
  v_user uuid; v_region uuid; v_node uuid; v_enc uuid;
  v_a uuid; v_b uuid; v_cc uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_item uuid; v_uniq uuid; v_lt uuid;
  v_inv uuid; v_eff uuid; v_act uuid; v_act2 uuid;
  v_chars uuid[]; v_creats uuid[];
  v_tok uuid := gen_random_uuid();
  v_tok2 uuid := gen_random_uuid();
  v_tok3 uuid := gen_random_uuid();
  v_snap jsonb; v_scope jsonb; v_digest jsonb; v_ver integer;
  v_before jsonb; v_after jsonb; v_r jsonb; v_reason text;
  v_prop jsonb; v_min jsonb;
  v_d1 uuid; v_d2 uuid; v_d3 uuid;
  v_now bigint;
  v_xp integer; v_xp2 integer; v_seq integer; v_n integer; v_n2 integer;
  v_fault text; v_sec jsonb; v_clean jsonb; v_pass integer; v_fail integer;
BEGIN
  v_now := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- ══ fixtures (isolated; removed at the end) ══
  SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('error', 'no auth user available for fixture ownership');
  END IF;

  INSERT INTO public.regions (name, description, min_level, max_level)
  VALUES ('C2 Harness Region', 'temporary validation fixture', 1, 50) RETURNING id INTO v_region;
  INSERT INTO public.nodes (region_id, name, x, y)
  VALUES (v_region, 'C2 Harness Node', 9999, 9999) RETURNING id INTO v_node;

  INSERT INTO public.items (name, rarity, slot, level, weapon_die, weapon_tag, hands)
  VALUES ('C2 Harness Blade', 'common'::item_rarity, 'main_hand'::item_slot, 1, '1d6', 'sword', 1)
  RETURNING id INTO v_item;
  INSERT INTO public.items (name, rarity, level)
  VALUES ('C2 Harness Relic', 'unique'::item_rarity, 1) RETURNING id INTO v_uniq;

  INSERT INTO public.loot_tables (name) VALUES ('C2 Harness Table') RETURNING id INTO v_lt;
  INSERT INTO public.loot_table_entries (loot_table_id, item_id, weight) VALUES (v_lt, v_item, 10);

  INSERT INTO public.creatures (name, node_id, rarity, level, hp, max_hp, ac, loot_mode, loot_table_id, drop_chance)
  VALUES ('C2 Harness Grub', v_node, 'regular'::creature_rarity, 3, 30, 30, 10, 'legacy_table', v_lt, 0.5)
  RETURNING id INTO v_c1;
  INSERT INTO public.creatures (name, node_id, rarity, level, hp, max_hp, ac, boss_cast)
  VALUES ('C2 Harness Tyrant', v_node, 'boss'::creature_rarity, 5, 80, 80, 12,
          jsonb_build_object('stored_power', jsonb_build_object('cap', 10)))
  RETURNING id INTO v_c2;
  INSERT INTO public.creatures (name, node_id, rarity, level, hp, max_hp, ac)
  VALUES ('C2 Harness Stray', v_node, 'regular'::creature_rarity, 2, 12, 12, 10)
  RETURNING id INTO v_c3;

  INSERT INTO public.characters (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, current_node_id)
  VALUES (v_user, 'C2harnessalpha', 'human', 'warrior', 5, 20, 20, 100, 100, 100, 100, v_node) RETURNING id INTO v_a;
  INSERT INTO public.characters (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, current_node_id)
  VALUES (v_user, 'C2harnessbeta', 'human', 'warrior', 5, 20, 20, 100, 100, 100, 100, v_node) RETURNING id INTO v_b;
  INSERT INTO public.characters (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, current_node_id)
  VALUES (v_user, 'C2harnessgamma', 'human', 'warrior', 5, 20, 20, 100, 100, 100, 100, v_node) RETURNING id INTO v_cc;

  SELECT id INTO v_enc FROM public.encounters WHERE node_id = v_node ORDER BY started_at LIMIT 1;
  IF v_enc IS NULL THEN
    INSERT INTO public.encounters (node_id, encounter_key, status)
    VALUES (v_node, 'default', 'active') RETURNING id INTO v_enc;
  END IF;
  UPDATE public.encounters SET tick_number = 0, tick_at = 0, tick_state = 'idle',
    resolving_tick = NULL, claim_token = NULL, resolver_id = NULL, lease_until = NULL,
    attempt = 0, version = 0, stored_power = 0, stored_power_cap = NULL, stored_power_source_id = NULL
  WHERE id = v_enc;

  DELETE FROM public.encounter_participants WHERE character_id IN (v_a, v_b, v_cc);
  INSERT INTO public.encounter_participants (encounter_id, character_id) VALUES (v_enc, v_a), (v_enc, v_b);
  INSERT INTO public.encounter_creatures (encounter_id, creature_id) VALUES (v_enc, v_c1), (v_enc, v_c2);
  INSERT INTO public.encounter_engagements (encounter_id, creature_id, character_id) VALUES (v_enc, v_c1, v_a);

  INSERT INTO public.character_inventory (character_id, item_id, equipped_slot, current_durability)
  VALUES (v_a, v_item, 'main_hand'::item_slot, 100) RETURNING id INTO v_inv;

  INSERT INTO public.active_effects (node_id, target_id, source_id, effect_type, stacks, damage_per_tick,
                                     expires_at, next_tick_at, tick_rate_ms, source_ability_key)
  VALUES (v_node, v_a, v_c1, 'c2h_dot', 1, 2, v_now + 600000, v_now + 2000, 2000, 'c2h_dot')
  RETURNING id INTO v_eff;

  INSERT INTO public.combat_actions (encounter_id, character_id, node_id, ability_key, target_creature_id, client_seq)
  VALUES (v_enc, v_a, v_node, 'c2h_attack', v_c1, 1) RETURNING id INTO v_act;
  INSERT INTO public.combat_actions (encounter_id, character_id, node_id, ability_key, target_creature_id, client_seq)
  VALUES (v_enc, v_b, v_node, 'c2h_attack', v_c1, 1) RETURNING id INTO v_act2;

  v_chars := ARRAY[v_a, v_b, v_cc];
  v_creats := ARRAY[v_c1, v_c2, v_c3];

  -- ══ claim tick 3 ══
  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 3, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000, tick_mode = 'live', attempt = 1
  WHERE id = v_enc;

  v_snap := public.encounter_snapshot_v2(v_enc, v_tok, 3);
  t := public.c2h_rec(t, 'snapshot.loads', 'true', (v_snap->>'loaded'), NULL, NULL,
       'snapshotVersion=' || COALESCE(v_snap->>'snapshotVersion','-'));
  v_scope := v_snap->'scope';
  v_digest := v_snap->'stateDigest';
  v_ver := (v_snap->>'encounterVersion')::integer;

  t := public.c2h_rec(t, 'snapshot.dropChanceResolved', 'true',
       ((SELECT (x->>'effectiveDropChance')::numeric FROM jsonb_array_elements(v_snap->'creatures') x
         WHERE x->>'id' = v_c1::text) = 0.5)::text, NULL, NULL, 'authored creature drop_chance wins');
  t := public.c2h_rec(t, 'snapshot.storedPowerCapSource', 'inactive',
       v_snap#>>'{storedPower,capSource}', NULL, NULL, 'no active cast, no encounter default');

  v_d1 := public.encounter_death_id(v_enc, v_c1, 1, 3);

  v_prop := jsonb_build_object(
    'proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 3,
    'creatures', jsonb_build_array(jsonb_build_object(
      'creatureId', v_c1, 'spawnSeq', 1, 'hpBefore', 30, 'hpAfter', 0, 'killed', true,
      'creatureName', 'C2 Harness Grub')),
    'characters', jsonb_build_array(jsonb_build_object(
      'characterId', v_a, 'hpBefore', 20, 'hpAfter', 18, 'cpBefore', 100, 'cpAfter', 95,
      'absorbShieldAfter', 0, 'died', false)),
    'rewards', jsonb_build_array(
      jsonb_build_object('characterId', v_a, 'creatureId', v_c1, 'spawnSeq', 1, 'deathId', v_d1,
                         'xp', 10, 'gold', 5, 'renown', 1),
      jsonb_build_object('characterId', v_b, 'creatureId', v_c1, 'spawnSeq', 1, 'deathId', v_d1,
                         'xp', 7, 'gold', 3, 'renown', 1)),
    'materials', jsonb_build_array(jsonb_build_object(
      'characterId', v_a, 'materialKey', 'salvage', 'quantity', 3, 'creatureId', v_c1,
      'spawnSeq', 1, 'deathId', v_d1, 'ordinal', 0)),
    'loot', jsonb_build_array(jsonb_build_object(
      'deathId', v_d1, 'creatureId', v_c1, 'spawnSeq', 1, 'creatureName', 'C2 Harness Grub',
      'mode', 'explicit', 'lootTableId', v_lt, 'itemId', v_uniq, 'dropChance', 1)),
    'effectUpserts', jsonb_build_array(jsonb_build_object(
      'targetId', v_a, 'sourceId', v_a, 'effectType', 'c2h_buff', 'stacks', 1, 'amountPerTick', 0,
      'expiresAtMs', v_now + 600000, 'intervalMs', 2000, 'lastTickAtMs', v_now, 'sourceAbilityKey', 'c2h_buff')),
    'engagementsJoin', jsonb_build_array(jsonb_build_object('creatureId', v_c2, 'characterId', v_a)),
    'engagementsPurgeCreatureIds', jsonb_build_array(v_c1),
    'durability', jsonb_build_array(jsonb_build_object(
      'characterId', v_a, 'inventoryId', v_inv, 'durabilityAfter', 99)),
    'casts', jsonb_build_array(jsonb_build_object(
      'creatureId', v_c2, 'abilityKey', 'c2h_cast', 'phase', 'start', 'resolvesAtMs', v_now + 4000,
      'payload', jsonb_build_object('damage', 5))),
    'storedPower', jsonb_build_array(jsonb_build_object('creatureId', v_c2, 'currentAfter', 5, 'cap', 10)),
    'contributions', jsonb_build_array(jsonb_build_object(
      'characterId', v_a, 'damageDealt', 30, 'healingDone', 0)),
    'actionTerminal', jsonb_build_array(jsonb_build_object('id', v_act, 'status', 'consumed')),
    'events', '[]'::jsonb, 'deaths', '[]'::jsonb,
    'kills', jsonb_build_array(jsonb_build_object('creatureId', v_c1, 'deathId', v_d1, 'spawnSeq', 1)));

  v_min := jsonb_build_object('proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 3);

  -- ══ A. refusal + zero-write matrix ══
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(gen_random_uuid(), 3, v_tok, gen_random_uuid(), 2, v_ver,
         v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.no_encounter', 'no_encounter', v_r->>'reason', v_before, v_after);

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 1, v_ver, v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.version_unsupported.snapshot', 'version_unsupported', v_r->>'reason', v_before, v_after);

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('proposedTickVersion', 1));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.version_unsupported.proposal', 'version_unsupported', v_r->>'reason', v_before, v_after);

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 0, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.already_committed', 'already_committed', v_r->>'reason', v_before, v_after);

  BEGIN
    INSERT INTO public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
    VALUES (v_enc, 3, gen_random_uuid(), '{"c2h":"pre-existing"}'::jsonb);
    v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
    v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_prop);
    v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
    t := public.c2h_rec(t, 'refusal.duplicate_batch', 'duplicate_batch', v_r->>'reason', v_before, v_after);
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN
      t := public.c2h_rec(t, 'refusal.duplicate_batch', 'duplicate_batch', 'error:' || SQLERRM);
    END IF;
  END;

  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 3, gen_random_uuid(), gen_random_uuid(), 2, v_ver,
         v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.stale_claim', 'stale_claim', v_r->>'reason', v_before, v_after);

  UPDATE public.encounters SET lease_until = v_now - 5000 WHERE id = v_enc;
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.lease_expired', 'lease_expired', v_r->>'reason', v_before, v_after);
  t := public.c2h_rec(t, 'refusal.lease_expired.snapshot', 'lease_expired',
       public.encounter_snapshot_v2(v_enc, v_tok, 3)->>'reason');
  UPDATE public.encounters SET lease_until = v_now + 600000 WHERE id = v_enc;

  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver + 5, v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.version_conflict', 'version_conflict', v_r->>'reason', v_before, v_after);

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope,
         v_digest || jsonb_build_object('creatures', 'deadbeef'), v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'refusal.state_conflict', 'state_conflict', v_r->>'reason', v_before, v_after);

  -- invalid_proposal family
  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('characters', jsonb_build_array(jsonb_build_object(
           'characterId', v_a, 'hpBefore', 20, 'hpAfter', 999, 'cpAfter', 95, 'absorbShieldAfter', 0))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.hp_bounds', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('characters', jsonb_build_array(jsonb_build_object(
           'characterId', v_a, 'hpBefore', 20, 'hpAfter', 18, 'cpAfter', -4, 'absorbShieldAfter', 0))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.cp_bounds', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('characters', jsonb_build_array(jsonb_build_object(
           'characterId', v_a, 'hpBefore', 20, 'hpAfter', 18, 'cpAfter', 95, 'mpAfter', 5000,
           'absorbShieldAfter', 0))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.mp_bounds', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('durability', jsonb_build_array(jsonb_build_object(
           'characterId', v_a, 'inventoryId', v_inv, 'durabilityAfter', 150))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.durability_illegal', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('durability', jsonb_build_array(jsonb_build_object(
           'characterId', v_a, 'inventoryId', gen_random_uuid(), 'durabilityAfter', 90))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.unknown_equipment', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('characters', jsonb_build_array(jsonb_build_object(
           'characterId', v_cc, 'hpBefore', 20, 'hpAfter', 18, 'cpAfter', 95, 'absorbShieldAfter', 0))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.unknown_participant', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('creatures', jsonb_build_array(jsonb_build_object(
           'creatureId', v_c3, 'spawnSeq', 1, 'hpBefore', 12, 'hpAfter', 0, 'killed', true))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.unknown_creature', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('actionTerminal', jsonb_build_array(jsonb_build_object(
           'id', gen_random_uuid(), 'status', 'consumed'))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.unknown_action', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('rewards', jsonb_build_array(jsonb_build_object(
           'characterId', v_cc, 'creatureId', v_c1, 'spawnSeq', 1, 'deathId', v_d1,
           'xp', 10, 'gold', 5, 'renown', 1))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.reward_recipient', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('rewards', jsonb_build_array(jsonb_build_object(
           'characterId', v_a, 'creatureId', v_c1, 'spawnSeq', 1, 'deathId', v_d1,
           'xp', -50, 'gold', 5, 'renown', 1))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.reward_bounds', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('storedPower', jsonb_build_array(jsonb_build_object(
           'creatureId', v_c2, 'currentAfter', 99, 'cap', 10))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.stored_power_over_cap', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('casts', jsonb_build_array(jsonb_build_object(
           'creatureId', v_c3, 'abilityKey', 'c2h_cast', 'phase', 'start'))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.cast_creature_outside_encounter', 'invalid_proposal', v_r->>'reason',
       v_before, v_after, v_r->>'detail');

  v_before := v_after;
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
         v_prop || jsonb_build_object('loot', jsonb_build_array(jsonb_build_object(
           'deathId', v_d1, 'creatureId', v_c1, 'spawnSeq', 1, 'mode', 'explicit',
           'itemId', gen_random_uuid(), 'dropChance', 1))));
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'invalid.loot_item_unknown', 'invalid_proposal', v_r->>'reason', v_before, v_after, v_r->>'detail');

  -- ══ B. forced transactional failures (rollback proofs) ══
  EXECUTE $x$CREATE TRIGGER c2h_f_creatures AFTER UPDATE ON public.creatures
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_fault('creatures')$x$;
  EXECUTE $x$CREATE TRIGGER c2h_f_characters AFTER UPDATE ON public.characters
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_fault('characters')$x$;
  EXECUTE $x$CREATE TRIGGER c2h_f_awards AFTER INSERT ON public.encounter_kill_awards
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_fault('kill_awards')$x$;
  EXECUTE $x$CREATE TRIGGER c2h_f_loot AFTER INSERT ON public.encounter_death_loot
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_fault('death_loot')$x$;
  EXECUTE $x$CREATE TRIGGER c2h_f_inv AFTER UPDATE ON public.character_inventory
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_fault('durability')$x$;
  EXECUTE $x$CREATE TRIGGER c2h_f_batch BEFORE INSERT ON public.encounter_tick_batches
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_fault('batch')$x$;
  EXECUTE $x$CREATE TRIGGER c2h_f_dup AFTER UPDATE ON public.creatures
            FOR EACH STATEMENT EXECUTE FUNCTION public.c2h_dup_batch()$x$;

  FOREACH v_fault IN ARRAY ARRAY['creatures','characters','kill_awards','death_loot','durability','batch'] LOOP
    v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
    v_reason := NULL;
    BEGIN
      PERFORM set_config('c2h.fail_at', v_fault, true);
      v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_prop);
      v_reason := 'no_exception:' || COALESCE(v_r->>'committed', '-');
    EXCEPTION WHEN OTHERS THEN
      v_reason := 'rolled_back';
    END;
    PERFORM set_config('c2h.fail_at', '', true);
    v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
    t := public.c2h_rec(t, 'fault.' || v_fault, 'rolled_back', v_reason, v_before, v_after);
  END LOOP;

  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_reason := NULL;
  BEGIN
    PERFORM set_config('c2h.dup_batch', v_enc::text || ':3', true);
    v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_prop);
    v_reason := 'no_exception:' || COALESCE(v_r->>'committed', '-');
  EXCEPTION WHEN OTHERS THEN
    v_reason := 'rolled_back:' || SQLSTATE;
  END;
  PERFORM set_config('c2h.dup_batch', '', true);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'fault.forced_duplicate_batch', 'rolled_back:23505', v_reason, v_before, v_after);

  -- ══ C. successful commit ══
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_prop);
  t := public.c2h_rec(t, 'commit.tick3', 'true', v_r->>'committed', NULL, NULL, v_r::text);

  SELECT xp INTO v_xp FROM public.characters WHERE id = v_a;
  SELECT count(*) INTO v_n FROM public.encounter_kill_awards WHERE encounter_id = v_enc;
  t := public.c2h_rec(t, 'commit.rewards_applied', '10', v_xp::text);
  t := public.c2h_rec(t, 'commit.ledger_rows', '3', v_n::text, NULL, NULL, '2 rewards + 1 material');
  t := public.c2h_rec(t, 'commit.creature_dead', 'false',
       (SELECT is_alive::text FROM public.creatures WHERE id = v_c1));
  t := public.c2h_rec(t, 'commit.spawn_seq_untouched', '1',
       (SELECT spawn_seq::text FROM public.creatures WHERE id = v_c1));
  t := public.c2h_rec(t, 'commit.action_consumed', 'consumed',
       (SELECT status FROM public.combat_actions WHERE id = v_act));
  t := public.c2h_rec(t, 'commit.action_untouched_still_pending', 'pending',
       (SELECT status FROM public.combat_actions WHERE id = v_act2));
  t := public.c2h_rec(t, 'commit.cursor', 'tick=3;state=idle;token=-;version=' || (v_ver + 1),
       (SELECT 'tick=' || e.tick_number || ';state=' || e.tick_state || ';token=' ||
               COALESCE(e.claim_token::text, '-') || ';version=' || e.version
        FROM public.encounters e WHERE e.id = v_enc));
  t := public.c2h_rec(t, 'commit.batch_written', '1',
       (SELECT count(*)::text FROM public.encounter_tick_batches WHERE encounter_id = v_enc AND tick_number = 3));
  t := public.c2h_rec(t, 'commit.ground_loot_unique', '1',
       (SELECT count(*)::text FROM public.node_ground_loot WHERE node_id = v_node AND item_id = v_uniq));
  t := public.c2h_rec(t, 'commit.durability_applied', '99',
       (SELECT current_durability::text FROM public.character_inventory WHERE id = v_inv));
  t := public.c2h_rec(t, 'commit.stored_power', 'sp=5|cap=10',
       (SELECT 'sp=' || stored_power || '|cap=' || COALESCE(stored_power_cap::text,'-')
        FROM public.encounters WHERE id = v_enc));

  -- ══ D. idempotency + respawn ══
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 3, v_tok, gen_random_uuid(), 2, v_ver + 1, v_scope, v_digest, v_prop);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'idempotency.exact_replay', 'already_committed', v_r->>'reason', v_before, v_after);

  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 4, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000, attempt = 1 WHERE id = v_enc;
  v_snap := public.encounter_snapshot_v2(v_enc, v_tok, 4);
  v_scope := v_snap->'scope'; v_digest := v_snap->'stateDigest'; v_ver := (v_snap->>'encounterVersion')::integer;
  SELECT xp INTO v_xp FROM public.characters WHERE id = v_a;
  SELECT count(*) INTO v_n FROM public.encounter_kill_awards WHERE encounter_id = v_enc;
  v_r := public.commit_encounter_tick_v2(v_enc, 4, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
    jsonb_build_object('proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 4,
      'rewards', v_prop->'rewards', 'materials', v_prop->'materials', 'loot', v_prop->'loot'));
  SELECT xp INTO v_xp2 FROM public.characters WHERE id = v_a;
  SELECT count(*) INTO v_n2 FROM public.encounter_kill_awards WHERE encounter_id = v_enc;
  t := public.c2h_rec(t, 'idempotency.same_death_id_new_tick', 'committed=true;xp=' || v_xp || ';awards=' || v_n,
       'committed=' || COALESCE(v_r->>'committed','-') || ';xp=' || v_xp2 || ';awards=' || v_n2);
  t := public.c2h_rec(t, 'idempotency.death_loot_single', '1',
       (SELECT count(*)::text FROM public.encounter_death_loot WHERE death_id = v_d1));
  t := public.c2h_rec(t, 'idempotency.unique_item_single_instance', '1',
       (SELECT count(*)::text FROM public.node_ground_loot WHERE node_id = v_node AND item_id = v_uniq));

  SELECT spawn_seq INTO v_seq FROM public.creatures WHERE id = v_c1;
  UPDATE public.creatures SET hp = 20 WHERE id = v_c1;
  t := public.c2h_rec(t, 'respawn.ordinary_update_no_bump', v_seq::text,
       (SELECT spawn_seq::text FROM public.creatures WHERE id = v_c1));
  UPDATE public.creatures SET is_alive = true, hp = max_hp WHERE id = v_c1;
  t := public.c2h_rec(t, 'respawn.single_increment', (v_seq + 1)::text,
       (SELECT spawn_seq::text FROM public.creatures WHERE id = v_c1));
  UPDATE public.creatures SET is_alive = true WHERE id = v_c1;
  t := public.c2h_rec(t, 'respawn.alive_to_alive_no_bump', (v_seq + 1)::text,
       (SELECT spawn_seq::text FROM public.creatures WHERE id = v_c1));

  v_d2 := public.encounter_death_id(v_enc, v_c1, v_seq + 1, 5);
  t := public.c2h_rec(t, 'respawn.new_death_id', 'true', (v_d2 <> v_d1)::text, NULL, NULL,
       'd1=' || v_d1 || ' d2=' || v_d2);

  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 5, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000, attempt = 1 WHERE id = v_enc;
  v_snap := public.encounter_snapshot_v2(v_enc, v_tok, 5);
  v_scope := v_snap->'scope'; v_digest := v_snap->'stateDigest'; v_ver := (v_snap->>'encounterVersion')::integer;
  SELECT xp INTO v_xp FROM public.characters WHERE id = v_a;
  v_r := public.commit_encounter_tick_v2(v_enc, 5, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
    jsonb_build_object('proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 5,
      'creatures', jsonb_build_array(jsonb_build_object('creatureId', v_c1, 'spawnSeq', v_seq + 1,
        'hpBefore', (SELECT hp FROM public.creatures WHERE id = v_c1), 'hpAfter', 0, 'killed', true,
        'creatureName', 'C2 Harness Grub')),
      'rewards', jsonb_build_array(
        jsonb_build_object('characterId', v_a, 'creatureId', v_c1, 'spawnSeq', v_seq + 1, 'deathId', v_d2,
                           'xp', 10, 'gold', 5, 'renown', 1),
        jsonb_build_object('characterId', v_b, 'creatureId', v_c1, 'spawnSeq', v_seq + 1, 'deathId', v_d2,
                           'xp', 7, 'gold', 3, 'renown', 1)),
      'loot', jsonb_build_array(jsonb_build_object('deathId', v_d2, 'creatureId', v_c1, 'spawnSeq', v_seq + 1,
        'creatureName', 'C2 Harness Grub', 'mode', 'explicit', 'itemId', v_uniq, 'dropChance', 1))));
  SELECT xp INTO v_xp2 FROM public.characters WHERE id = v_a;
  t := public.c2h_rec(t, 'respawn.rewards_awarded_again', 'committed=true;xp=' || (v_xp + 10),
       'committed=' || COALESCE(v_r->>'committed','-') || ';xp=' || v_xp2);
  t := public.c2h_rec(t, 'respawn.multi_recipient_once', '2',
       (SELECT count(*)::text FROM public.encounter_kill_awards
        WHERE death_id = v_d2 AND award_kind = 'reward'));
  t := public.c2h_rec(t, 'respawn.unique_contention_resolves_once', '1',
       (SELECT count(*)::text FROM public.node_ground_loot WHERE node_id = v_node AND item_id = v_uniq),
       NULL, NULL, 'second death recorded its loot row but the world-unique item was not duplicated');
  t := public.c2h_rec(t, 'respawn.new_death_loot_row', '2',
       (SELECT count(*)::text FROM public.encounter_death_loot WHERE encounter_id = v_enc));

  -- rollback must not poison the ledger
  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 6, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000, attempt = 1 WHERE id = v_enc;
  v_snap := public.encounter_snapshot_v2(v_enc, v_tok, 6);
  v_scope := v_snap->'scope'; v_digest := v_snap->'stateDigest'; v_ver := (v_snap->>'encounterVersion')::integer;
  v_d3 := public.encounter_death_id(v_enc, v_c2, 1, 6);
  BEGIN
    PERFORM set_config('c2h.fail_at', 'death_loot', true);
    v_r := public.commit_encounter_tick_v2(v_enc, 6, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
      jsonb_build_object('proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 6,
        'rewards', jsonb_build_array(jsonb_build_object('characterId', v_a, 'creatureId', v_c2,
          'spawnSeq', 1, 'deathId', v_d3, 'xp', 20, 'gold', 0, 'renown', 0)),
        'loot', jsonb_build_array(jsonb_build_object('deathId', v_d3, 'creatureId', v_c2, 'spawnSeq', 1,
          'mode', 'pool', 'dropChance', 1))));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM set_config('c2h.fail_at', '', true);
  t := public.c2h_rec(t, 'rollback.no_ledger_residue', '0',
       (SELECT count(*)::text FROM public.encounter_kill_awards WHERE death_id = v_d3));
  SELECT xp INTO v_xp FROM public.characters WHERE id = v_a;
  v_r := public.commit_encounter_tick_v2(v_enc, 6, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest,
    jsonb_build_object('proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 6,
      'rewards', jsonb_build_array(jsonb_build_object('characterId', v_a, 'creatureId', v_c2,
        'spawnSeq', 1, 'deathId', v_d3, 'xp', 20, 'gold', 0, 'renown', 0))));
  SELECT xp INTO v_xp2 FROM public.characters WHERE id = v_a;
  t := public.c2h_rec(t, 'rollback.later_valid_reward_allowed', 'committed=true;xp=' || (v_xp + 20),
       'committed=' || COALESCE(v_r->>'committed','-') || ';xp=' || v_xp2);

  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_creatures ON public.creatures';
  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_characters ON public.characters';
  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_awards ON public.encounter_kill_awards';
  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_loot ON public.encounter_death_loot';
  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_inv ON public.character_inventory';
  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_batch ON public.encounter_tick_batches';
  EXECUTE 'DROP TRIGGER IF EXISTS c2h_f_dup ON public.creatures';
  t := public.c2h_rec(t, 'fault.injection_removed', '0',
       (SELECT count(*)::text FROM pg_trigger WHERE tgname LIKE 'c2h_%'));

  -- ══ E. snapshot concurrency ══
  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 7, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000, attempt = 1 WHERE id = v_enc;
  v_snap := public.encounter_snapshot_v2(v_enc, v_tok, 7);
  v_scope := v_snap->'scope'; v_digest := v_snap->'stateDigest'; v_ver := (v_snap->>'encounterVersion')::integer;
  v_min := jsonb_build_object('proposedTickVersion', 2, 'mode', 'live', 'tickNumber', 7);

  t := public.c2h_rec(t, 'concurrency.overlapping_authority.snapshot', 'stale_claim',
       public.encounter_snapshot_v2(v_enc, gen_random_uuid(), 7)->>'reason', NULL, NULL,
       'a second resolver cannot load the same claimed tick');
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 7, gen_random_uuid(), gen_random_uuid(), 2, v_ver,
         v_scope, v_digest, v_min);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'concurrency.overlapping_authority.commit', 'stale_claim', v_r->>'reason', v_before, v_after);

  -- conflict cases (each mutation is rolled back after the probe)
  BEGIN
    UPDATE public.combat_actions SET client_seq = client_seq + 1 WHERE id = v_act2;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.action_changed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.combat_actions SET status = 'consumed' WHERE id = v_act2;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.action_consumed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.creatures SET hp = hp - 3 WHERE id = v_c2;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.creature_changed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.characters SET hp = hp - 1 WHERE id = v_a;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.character_changed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.active_effects SET stacks = stacks + 1 WHERE id = v_eff;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.effect_changed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.character_inventory SET current_durability = 50 WHERE id = v_inv;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.equipment_changed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.encounter_cast_events SET payload = payload || '{"c2h":"mutated"}'::jsonb
    WHERE encounter_id = v_enc AND resolved_at IS NULL;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.cast_changed', 'state_conflict', v_reason);

  BEGIN
    UPDATE public.encounters SET stored_power = stored_power + 1 WHERE id = v_enc;
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.stored_power_changed', 'state_conflict', v_reason);

  BEGIN
    INSERT INTO public.combat_config (key, value) VALUES ('c2h_probe', 'x');
    v_reason := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'reason';
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.config_changed', 'state_conflict', v_reason);

  -- non-conflict cases
  BEGIN
    INSERT INTO public.combat_actions (encounter_id, character_id, node_id, ability_key, target_creature_id, client_seq)
    VALUES (v_enc, v_b, v_node, 'c2h_late', v_c2, 99);
    v_reason := COALESCE(public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'committed', '-')
                || ';late_action=' || (SELECT status FROM public.combat_actions
                                       WHERE encounter_id = v_enc AND ability_key = 'c2h_late');
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.post_snapshot_action_ok', 'true;late_action=pending', v_reason);

  BEGIN
    INSERT INTO public.encounter_participants (encounter_id, character_id) VALUES (v_enc, v_cc);
    v_reason := COALESCE(public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'committed', '-');
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.new_participant_documented_rule', 'true', v_reason, NULL, NULL,
       'out of scope: tick commits, the new participant is eligible from the next tick');

  BEGIN
    INSERT INTO public.encounter_engagements (encounter_id, creature_id, character_id)
    VALUES (v_enc, v_c2, v_b);
    v_reason := COALESCE(public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'committed', '-');
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.new_engagement_documented_rule', 'true', v_reason);

  BEGIN
    INSERT INTO public.encounter_creatures (encounter_id, creature_id) VALUES (v_enc, v_c3);
    INSERT INTO public.node_ground_loot (node_id, item_id, creature_name) VALUES (v_node, v_item, 'unrelated');
    v_reason := COALESCE(public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver,
                v_scope, v_digest, v_min)->>'committed', '-');
    RAISE EXCEPTION 'c2h_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'c2h_rollback' THEN v_reason := 'error:' || SQLERRM; END IF;
  END;
  t := public.c2h_rec(t, 'concurrency.unrelated_rows_ok', 'true', v_reason);

  -- ══ F. claim lifecycle ══
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.release_encounter_tick(v_enc, 7, gen_random_uuid(), 'stale_probe');
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'claim.stale_release_refused', 'stale_claim', v_r->>'reason', v_before, v_after);

  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.release_encounter_tick(v_enc, 7, v_tok, 'alpha');
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'claim.release_ok', 'true', v_r->>'released');
  t := public.c2h_rec(t, 'claim.release_touches_ownership_only', '["encounterCursor"]',
       (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb)::text
        FROM jsonb_object_keys(public.c2h_diff(v_before, v_after)) k));
  t := public.c2h_rec(t, 'claim.release_keeps_cursor', 'tick=6',
       (SELECT 'tick=' || tick_number FROM public.encounters WHERE id = v_enc));

  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 7, v_tok, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_min);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'claim.commit_after_release', 'stale_claim', v_r->>'reason', v_before, v_after);

  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 7, claim_token = v_tok2,
    resolver_id = gen_random_uuid(), lease_until = v_now - 1000, attempt = 1 WHERE id = v_enc;
  t := public.c2h_rec(t, 'claim.lease_expired_snapshot', 'lease_expired',
       public.encounter_snapshot_v2(v_enc, v_tok2, 7)->>'reason');
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 7, v_tok2, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_min);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'claim.lease_expired_commit', 'lease_expired', v_r->>'reason', v_before, v_after);

  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 7, claim_token = v_tok3,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000, attempt = 2 WHERE id = v_enc;
  v_snap := public.encounter_snapshot_v2(v_enc, v_tok3, 7);
  t := public.c2h_rec(t, 'claim.reclaim_same_tick', '7', v_snap->>'tickNumber');
  v_scope := v_snap->'scope'; v_digest := v_snap->'stateDigest'; v_ver := (v_snap->>'encounterVersion')::integer;
  v_r := public.commit_encounter_tick_v2(v_enc, 7, v_tok3, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_min);
  t := public.c2h_rec(t, 'claim.reclaimed_commit_ok', 'true', v_r->>'committed');
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  v_r := public.commit_encounter_tick_v2(v_enc, 7, v_tok2, gen_random_uuid(), 2, v_ver, v_scope, v_digest, v_min);
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'claim.lost_owner_cannot_commit', 'already_committed', v_r->>'reason', v_before, v_after);

  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 8, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000 WHERE id = v_enc;
  PERFORM public.release_encounter_tick(v_enc, 8, v_tok, 'reason_alpha');
  v_before := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  UPDATE public.encounters SET tick_state = 'resolving', resolving_tick = 8, claim_token = v_tok,
    resolver_id = gen_random_uuid(), lease_until = v_now + 600000 WHERE id = v_enc;
  PERFORM public.release_encounter_tick(v_enc, 8, v_tok, 'reason_beta_totally_different');
  v_after := public.c2h_state(v_enc, v_chars, v_creats, v_node);
  t := public.c2h_rec(t, 'claim.release_reason_not_persisted', 'true',
       (v_before IS NOT DISTINCT FROM v_after)::text, NULL, NULL,
       'two different diagnostic reasons leave byte-identical state');

  -- ══ G. pruning ══
  v_n := public.prune_encounter_tick_batches(1, 500);
  t := public.c2h_rec(t, 'prune.retention_floor_protects_fresh_batches', '3',
       (SELECT count(*)::text FROM public.encounter_tick_batches WHERE encounter_id = v_enc),
       NULL, NULL, 'prune(1s) floored to 180s; deleted elsewhere=' || v_n);

  -- ══ H. security / access ══
  SELECT jsonb_build_object(
    'functionGrants', (
      SELECT jsonb_object_agg(p.proname, jsonb_build_object(
        'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
        'public', has_function_privilege('public', p.oid, 'EXECUTE'),
        'securityDefiner', p.prosecdef,
        'searchPath', array_to_string(p.proconfig, ',')))
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('encounter_snapshot_v2','commit_encounter_tick_v2','release_encounter_tick',
                          'prune_encounter_tick_batches','encounter_state_digest','encounter_death_id',
                          'c2_harness_run','c2h_state')),
    'definerFunctionsWithoutSearchPath', (
      SELECT COALESCE(jsonb_agg(p.proname ORDER BY p.proname), '[]'::jsonb)
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
        AND (p.proconfig IS NULL OR NOT EXISTS (
          SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))),
    'ledgerTables', (
      SELECT jsonb_object_agg(c.relname, jsonb_build_object(
        'rlsEnabled', c.relrowsecurity,
        'policies', (SELECT COALESCE(jsonb_agg(pol.polname ORDER BY pol.polname), '[]'::jsonb)
                     FROM pg_policy pol WHERE pol.polrelid = c.oid),
        'anonSelect', has_table_privilege('anon', c.oid, 'SELECT'),
        'anonInsert', has_table_privilege('anon', c.oid, 'INSERT'),
        'authenticatedSelect', has_table_privilege('authenticated', c.oid, 'SELECT'),
        'authenticatedWrite', has_table_privilege('authenticated', c.oid, 'INSERT')))
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
        AND c.relname IN ('encounter_kill_awards','encounter_death_loot','encounter_tick_batches')),
    'combatMode', (SELECT value FROM public.combat_config WHERE key = 'combat_mode')
  ) INTO v_sec;

  -- ══ I. fixture removal ══
  DELETE FROM public.encounter_tick_batches WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_kill_awards WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_death_loot WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_contributions WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_engagements WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_cast_events WHERE encounter_id = v_enc;
  DELETE FROM public.combat_actions WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_participants WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_creatures WHERE encounter_id = v_enc;
  DELETE FROM public.combat_sessions WHERE node_id = v_node;
  DELETE FROM public.active_effects WHERE node_id = v_node
     OR target_id = ANY(v_chars) OR source_id = ANY(v_chars)
     OR target_id = ANY(v_creats) OR source_id = ANY(v_creats);
  DELETE FROM public.node_ground_loot WHERE node_id = v_node;
  DELETE FROM public.character_inventory WHERE character_id = ANY(v_chars);
  DELETE FROM public.character_materials WHERE character_id = ANY(v_chars);
  DELETE FROM public.characters WHERE id = ANY(v_chars);
  DELETE FROM public.creatures WHERE id = ANY(v_creats);
  DELETE FROM public.encounters WHERE node_id = v_node;
  DELETE FROM public.loot_table_entries WHERE loot_table_id = v_lt;
  DELETE FROM public.loot_tables WHERE id = v_lt;
  DELETE FROM public.items WHERE id IN (v_item, v_uniq);
  DELETE FROM public.nodes WHERE id = v_node;
  DELETE FROM public.regions WHERE id = v_region;
  DELETE FROM public.combat_config WHERE key = 'c2h_probe';

  SELECT jsonb_build_object(
    'characters', (SELECT count(*) FROM public.characters WHERE id = ANY(v_chars)),
    'creatures', (SELECT count(*) FROM public.creatures WHERE id = ANY(v_creats)),
    'encounters', (SELECT count(*) FROM public.encounters WHERE id = v_enc),
    'killAwards', (SELECT count(*) FROM public.encounter_kill_awards WHERE encounter_id = v_enc),
    'deathLoot', (SELECT count(*) FROM public.encounter_death_loot WHERE encounter_id = v_enc),
    'batches', (SELECT count(*) FROM public.encounter_tick_batches WHERE encounter_id = v_enc),
    'items', (SELECT count(*) FROM public.items WHERE id IN (v_item, v_uniq)),
    'nodes', (SELECT count(*) FROM public.nodes WHERE id = v_node),
    'regions', (SELECT count(*) FROM public.regions WHERE id = v_region),
    'faultTriggers', (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'c2h_%')
  ) INTO v_clean;

  SELECT count(*) FILTER (WHERE (x->>'pass')::boolean),
         count(*) FILTER (WHERE NOT (x->>'pass')::boolean)
  INTO v_pass, v_fail FROM jsonb_array_elements(t) x;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'summary', jsonb_build_object('total', v_pass + v_fail, 'passed', v_pass, 'failed', v_fail),
    'failures', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(t) x
                 WHERE NOT (x->>'pass')::boolean),
    'tests', t,
    'security', v_sec,
    'cleanup', v_clean,
    'fixtureIds', jsonb_build_object('encounter', v_enc, 'node', v_node, 'region', v_region,
                                     'characters', to_jsonb(v_chars), 'creatures', to_jsonb(v_creats)));
END;
$fn$;

REVOKE ALL ON FUNCTION public.c2_harness_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.c2_harness_run() TO service_role;