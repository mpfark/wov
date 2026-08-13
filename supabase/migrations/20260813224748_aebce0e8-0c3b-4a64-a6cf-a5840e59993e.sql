-- C3b: the snapshot carries every configuration value the resolver consumes,
-- and the scope names the parties whose composition was pinned.
CREATE OR REPLACE FUNCTION public.encounter_snapshot_v2(_encounter_id uuid, _claim_token uuid, _tick bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cfg public.loot_pool_config;
  v_fallback numeric := 0.5;   -- LOOT_FALLBACK_CHANCE (legacy value, explicit)
  v_out jsonb;
  v_scope jsonb;
  v_config jsonb;
  v_party_ids jsonb;
  v_cast jsonb;
  v_cast_cap numeric;
  v_cast_creature uuid;
  v_cap_source text;
  v_cap numeric;
BEGIN
  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('loaded', false, 'reason', 'no_encounter');
  END IF;
  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token THEN
    RETURN jsonb_build_object('loaded', false, 'reason', 'stale_claim');
  END IF;
  IF v_enc.lease_until IS NULL OR v_enc.lease_until <= v_now THEN
    RETURN jsonb_build_object('loaded', false, 'reason', 'lease_expired');
  END IF;

  SELECT * INTO v_cfg FROM public.loot_pool_config LIMIT 1;

  -- Stored Power cap precedence:
  --   active cast override -> casting creature config -> encounter default -> inactive
  SELECT ce.payload, ce.creature_id INTO v_cast, v_cast_creature
  FROM public.encounter_cast_events ce
  WHERE ce.encounter_id = _encounter_id AND ce.resolved_at IS NULL
  ORDER BY ce.started_at DESC NULLS LAST
  LIMIT 1;

  v_cast_cap := NULLIF((v_cast #>> '{stored_power,cap}')::numeric, 0);
  IF v_cast_cap IS NOT NULL AND v_cast_cap > 0 THEN
    v_cap := v_cast_cap; v_cap_source := 'active_cast';
  ELSE
    SELECT NULLIF((cr.boss_cast #>> '{stored_power,cap}')::numeric, 0)
    INTO v_cap FROM public.creatures cr WHERE cr.id = v_cast_creature;
    IF v_cap IS NOT NULL AND v_cap > 0 THEN
      v_cap_source := 'casting_creature';
    ELSIF COALESCE(v_enc.stored_power_cap, 0) > 0 THEN
      v_cap := v_enc.stored_power_cap; v_cap_source := 'encounter_default';
    ELSE
      v_cap := 0; v_cap_source := 'inactive';
    END IF;
  END IF;

  -- One statement, one MVCC view, for every section of the snapshot.
  SELECT jsonb_build_object(
    'loaded', true,
    'snapshotVersion', 3,
    'encounterId', _encounter_id,
    'nodeId', v_enc.node_id,
    'tickNumber', _tick,
    'encounterVersion', v_enc.version,
    'loadedAtMs', v_now,
    'tickRateMs', COALESCE(NULLIF((v_enc.state->>'tick_rate_ms')::integer, 0), 2000),
    'lootFallbackChance', v_fallback,
    'claim', jsonb_build_object(
      'token', v_enc.claim_token, 'tick', _tick, 'attempt', v_enc.attempt,
      'leaseUntilMs', v_enc.lease_until, 'mode', v_enc.tick_mode),
    'cursor', jsonb_build_object(
      'tickNumber', v_enc.tick_number, 'tickAtMs', v_enc.tick_at,
      'tickState', v_enc.tick_state, 'resolvingTick', v_enc.resolving_tick),
    'storedPower', jsonb_build_object(
      'current', v_enc.stored_power, 'cap', v_cap, 'capSource', v_cap_source,
      'castingCreatureId', v_cast_creature, 'sourceId', v_enc.stored_power_source_id),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'level', c.level, 'classKey', c.class,
        'hp', c.hp, 'maxHp', c.max_hp, 'cp', c.cp, 'maxCp', c.max_cp,
        'mp', c.mp, 'maxMp', c.max_mp, 'ac', c.ac,
        'xp', COALESCE(c.xp, 0),
        'unspentStatPoints', COALESCE(c.unspent_stat_points, 0),
        'respecPoints', COALESCE(c.respec_points, 0),
        'bhp', COALESCE(c.bhp, 0),
        'attrs', jsonb_build_object('str', c.str, 'dex', c.dex, 'con', c.con,
                                    'int', c.int, 'wis', c.wis, 'cha', c.cha),
        'stanceState', c.stance_state, 'reservedBuffs', c.reserved_buffs,
        'partyId', (SELECT pm.party_id FROM public.party_members pm
                    WHERE pm.character_id = c.id AND pm.status = 'active' LIMIT 1),
        'joinedAtMs', (extract(epoch from ep.joined_at) * 1000)::bigint,
        'rowVersion', extract(epoch from ep.joined_at)::bigint,
        'equipment', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'inventoryId', ci.id, 'itemId', ci.item_id, 'slot', ci.equipped_slot,
            'currentDurability', ci.current_durability,
            'rarity', it.rarity, 'itemLevel', it.level, 'weaponTag', it.weapon_tag,
            'hands', it.hands, 'weaponDie', it.weapon_die, 'procs', it.procs,
            'stats', COALESCE(ci.stat_override, it.stats), 'appliedGems', ci.applied_gems)
            ORDER BY ci.id)
          FROM public.character_inventory ci
          JOIN public.items it ON it.id = ci.item_id
          WHERE ci.character_id = c.id AND ci.equipped_slot IS NOT NULL), '[]'::jsonb)
      ) ORDER BY ep.joined_at, c.id)
      FROM public.encounter_participants ep
      JOIN public.characters c ON c.id = ep.character_id
      WHERE ep.encounter_id = _encounter_id), '[]'::jsonb),
    'creatures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'name', cr.name, 'level', cr.level, 'rarity', cr.rarity,
        'hp', cr.hp, 'maxHp', cr.max_hp, 'ac', cr.ac, 'isAlive', cr.is_alive,
        'spawnSeq', cr.spawn_seq, 'isHumanoid', cr.is_humanoid,
        'attrs', cr.stats, 'lootMode', COALESCE(cr.loot_mode, 'legacy_table'),
        'lootTableId', cr.loot_table_id, 'lootTable', cr.loot_table,
        'bossCast', cr.boss_cast,
        'configuredStoredPowerCap',
          COALESCE(NULLIF((cr.boss_cast #>> '{stored_power,cap}')::numeric, 0), 0),
        -- explicit loot precedence: authored -> pool config -> legacy fallback (0.5)
        'effectiveDropChance', COALESCE(
          cr.drop_chance,
          CASE cr.rarity
            WHEN 'boss'::creature_rarity THEN v_cfg.drop_chance_boss
            WHEN 'rare'::creature_rarity THEN v_cfg.drop_chance_rare
            ELSE v_cfg.drop_chance_regular
          END,
          v_fallback),
        'dropChanceSource', CASE
          WHEN cr.drop_chance IS NOT NULL THEN 'creature'
          WHEN v_cfg.id IS NOT NULL THEN 'pool_config'
          ELSE 'legacy_fallback' END,
        'rowVersion', COALESCE(extract(epoch from cr.last_damaged_at)::bigint, 0)
      ) ORDER BY cr.id)
      FROM public.creatures cr
      JOIN public.encounter_creatures ec ON ec.creature_id = cr.id
      WHERE ec.encounter_id = _encounter_id), '[]'::jsonb),
    'engagements', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'creatureId', e.creature_id, 'characterId', e.character_id,
        'lastActionAtMs', (extract(epoch from e.last_action_at) * 1000)::bigint)
        ORDER BY e.creature_id, e.character_id)
      FROM public.encounter_engagements e WHERE e.encounter_id = _encounter_id), '[]'::jsonb),
    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'characterId', a.character_id, 'creatureId', a.target_creature_id,
        'allyId', a.target_character_id, 'abilityKey', a.ability_key,
        'clientSeq', a.client_seq, 'eligibleAfterMs', a.eligible_after_ms,
        'rowVersion', (extract(epoch from a.submitted_at) * 1000)::bigint)
        ORDER BY a.submitted_at, a.client_seq, a.id)
      FROM public.combat_actions a
      WHERE a.encounter_id = _encounter_id AND a.status = 'pending'
        AND (a.eligible_after_ms IS NULL OR a.eligible_after_ms <= v_now)), '[]'::jsonb),
    'effects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ae.id, 'targetId', ae.target_id, 'sourceId', ae.source_id,
        'effectType', ae.effect_type, 'stacks', ae.stacks,
        'amountPerTick', ae.damage_per_tick, 'expiresAtMs', ae.expires_at,
        'intervalMs', ae.tick_rate_ms, 'nextTickAtMs', ae.next_tick_at,
        'sourceAbilityKey', ae.source_ability_key,
        'rowVersion', (extract(epoch from ae.created_at) * 1000)::bigint)
        ORDER BY ae.id)
      FROM public.active_effects ae
      WHERE ae.target_id IN (
        SELECT ep.character_id FROM public.encounter_participants ep WHERE ep.encounter_id = _encounter_id
        UNION ALL
        SELECT ec.creature_id FROM public.encounter_creatures ec WHERE ec.encounter_id = _encounter_id
      )), '[]'::jsonb),
    'statusDefs', COALESCE((
      SELECT jsonb_agg(to_jsonb(s.*) ORDER BY s.key) FROM public.applied_statuses s), '[]'::jsonb),
    'casts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ce.id, 'creatureId', ce.creature_id, 'castKey', ce.cast_key,
        'abilityKey', ce.ability_key, 'payload', ce.payload,
        'startedAtMs', (extract(epoch from ce.started_at) * 1000)::bigint,
        'expiresAtMs', (extract(epoch from ce.expires_at) * 1000)::bigint)
        ORDER BY ce.id)
      FROM public.encounter_cast_events ce
      WHERE ce.encounter_id = _encounter_id AND ce.resolved_at IS NULL), '[]'::jsonb),
    'lootConfig', to_jsonb(v_cfg),
    'lootTables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'lootTableId', lte.loot_table_id, 'itemId', lte.item_id, 'weight', lte.weight)
        ORDER BY lte.loot_table_id, lte.id)
      FROM public.loot_table_entries lte
      WHERE lte.loot_table_id IN (
        SELECT cr.loot_table_id FROM public.creatures cr
        JOIN public.encounter_creatures ec ON ec.creature_id = cr.id
        WHERE ec.encounter_id = _encounter_id AND cr.loot_table_id IS NOT NULL)), '[]'::jsonb)
  ) INTO v_out;

  -- Parties whose composition this tick pinned (tank selection).
  SELECT COALESCE(jsonb_agg(DISTINCT x->>'partyId'), '[]'::jsonb) INTO v_party_ids
  FROM jsonb_array_elements(v_out->'participants') x
  WHERE x->>'partyId' IS NOT NULL;

  -- Configuration the resolver consumes. Read in the same MVCC view as the
  -- state above, and fingerprinted by encounter_state_digest.configVersion, so
  -- any change before commit is rejected as state_conflict.
  SELECT jsonb_build_object(
    'abilityConfigVersion', public.ability_config_version(),
    'xpBoostMultiplier', COALESCE((
      SELECT b.multiplier FROM public.xp_boost b
      WHERE b.expires_at IS NOT NULL
        AND (extract(epoch from b.expires_at) * 1000)::bigint > v_now
        AND b.multiplier > 0
      ORDER BY b.expires_at DESC LIMIT 1), 1),
    'weaponProgression', COALESCE((
      SELECT jsonb_build_object('tier1_level', w.tier1_level, 'tier2_level', w.tier2_level,
                                'tier3_level', w.tier3_level)
      FROM public.weapon_progression_config w ORDER BY w.id LIMIT 1),
      jsonb_build_object('tier1_level', 1, 'tier2_level', 10, 'tier3_level', 20)),
    'tanks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('partyId', p.id,
                                          'tankCharacterId', COALESCE(p.tank_id, p.leader_id))
             ORDER BY p.id)
      FROM public.parties p
      WHERE p.id::text IN (SELECT jsonb_array_elements_text(v_party_ids))
        AND COALESCE(p.tank_id, p.leader_id) IS NOT NULL), '[]'::jsonb)
  ) INTO v_config;

  -- Scope: the exact rows this snapshot read. The digest is parameterised by it.
  SELECT jsonb_build_object(
    'participantIds', COALESCE((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(v_out->'participants') x), '[]'::jsonb),
    'creatureIds',    COALESCE((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(v_out->'creatures') x), '[]'::jsonb),
    'actionIds',      COALESCE((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(v_out->'actions') x), '[]'::jsonb),
    'effectIds',      COALESCE((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(v_out->'effects') x), '[]'::jsonb),
    'castIds',        COALESCE((SELECT jsonb_agg(x->>'id') FROM jsonb_array_elements(v_out->'casts') x), '[]'::jsonb),
    'engagementPairs', COALESCE((SELECT jsonb_agg((x->>'creatureId') || '>' || (x->>'characterId'))
                                 FROM jsonb_array_elements(v_out->'engagements') x), '[]'::jsonb),
    'inventoryIds', COALESCE((
      SELECT jsonb_agg(eq->>'inventoryId')
      FROM jsonb_array_elements(v_out->'participants') p,
           jsonb_array_elements(p->'equipment') eq), '[]'::jsonb),
    'lootTableIds', COALESCE((
      SELECT jsonb_agg(DISTINCT x->>'lootTableId')
      FROM jsonb_array_elements(v_out->'lootTables') x), '[]'::jsonb),
    'partyIds', v_party_ids,
    'loadedAtMs', v_now
  ) INTO v_scope;

  RETURN v_out
    || jsonb_build_object('config', v_config)
    || jsonb_build_object('scope', v_scope)
    || jsonb_build_object('stateDigest', public.encounter_state_digest(_encounter_id, v_scope));
END;
$function$;