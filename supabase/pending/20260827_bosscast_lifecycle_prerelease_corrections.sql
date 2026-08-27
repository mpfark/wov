-- Pre-release correction to the authoritative boss-cast lifecycle.
-- NOT APPLIED: reviewed only. Apply during the coordinated maintenance window,
-- before deploying the matching Edge/frontend build.
--
--  1. Server-authoritative departure: a trigger on characters.current_node_id
--     ends participation for the node being left, so no client callback is load
--     bearing. `encounter_leave_node` remains as an idempotent client safeguard.
--  2. `encounter_leave_node` ownership is explicit: an authenticated caller must
--     own the character; a null-uid caller must be service_role.
--  3. Intake rotates the participation generation for a stale row, so a missed
--     departure cannot preserve the previous visit's identity.
--  4. The durable telegraph recovery boundary is fenced to the creature's live
--     spawn.
--  5. Unresolved legacy casts are closed before reopening.

-- 1/2. Departure: one internal implementation, two callers -------------------
CREATE OR REPLACE FUNCTION public.encounter_end_participation(_character_id uuid, _node_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enc uuid;
  v_engagements int := 0;
  v_participation int := 0;
BEGIN
  IF _character_id IS NULL OR _node_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_node');
  END IF;

  -- Strictly the encounter of the node being LEFT. A stale or reordered call
  -- can therefore never touch participation at the character's new node.
  SELECT e.id INTO v_enc
  FROM public.encounters e
  WHERE e.node_id = _node_id
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF v_enc IS NULL THEN
    BEGIN
      PERFORM public.arm_effects_catchup_for_node(_node_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RETURN jsonb_build_object('ok', true, 'encounter_id', NULL,
                              'engagements_removed', 0, 'participation_ended', 0);
  END IF;

  -- Serialise against intake for this encounter: departure and re-entry can
  -- never interleave halfway.
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  WITH del AS (
    DELETE FROM public.encounter_engagements
    WHERE encounter_id = v_enc AND character_id = _character_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_engagements FROM del;

  -- Only the owned character's row, only for the encounter of the node left.
  WITH del AS (
    DELETE FROM public.encounter_participants
    WHERE encounter_id = v_enc AND character_id = _character_id
    RETURNING 1
  )
  SELECT count(*)::int INTO v_participation FROM del;

  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'left_node', updated_at = now()
  WHERE character_id = _character_id
    AND status = 'pending'
    AND encounter_id = v_enc;

  BEGIN
    PERFORM public.arm_effects_catchup_for_node(_node_id);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Idempotent: a repeat call finds nothing to remove and reports zeroes.
  RETURN jsonb_build_object('ok', true, 'encounter_id', v_enc,
                            'engagements_removed', v_engagements,
                            'participation_ended', v_participation);
END;
$function$;

REVOKE ALL ON FUNCTION public.encounter_end_participation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_end_participation(uuid, uuid) TO service_role;

-- The authoritative departure: node movement and participation end in ONE
-- transaction, whatever moved the character (walk, flee, teleport, party
-- follow, admin relocation). No browser callback is load bearing.
CREATE OR REPLACE FUNCTION public.characters_end_participation_on_node_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.encounter_end_participation(OLD.id, OLD.current_node_id);
  EXCEPTION WHEN OTHERS THEN
    -- Movement must never fail because cleanup did; intake's stale-row check is
    -- the second line of defence.
    NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_characters_node_change_participation ON public.characters;
CREATE TRIGGER trg_characters_node_change_participation
AFTER UPDATE OF current_node_id ON public.characters
FOR EACH ROW
WHEN (OLD.current_node_id IS DISTINCT FROM NEW.current_node_id
      AND OLD.current_node_id IS NOT NULL)
EXECUTE FUNCTION public.characters_end_participation_on_node_change();

-- Client-callable safeguard, now with an explicit privilege gate.
CREATE OR REPLACE FUNCTION public.encounter_leave_node(_character_id uuid, _node_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Authenticated callers must own the character. A caller with no uid is only
  -- allowed when it is the service role (edge/recovery path).
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.owns_character(_character_id) THEN
      RAISE EXCEPTION 'not your character';
    END IF;
  ELSIF COALESCE(auth.role(), current_user) <> 'service_role' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN public.encounter_end_participation(_character_id, _node_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.encounter_leave_node(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_leave_node(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.encounter_leave_node(uuid, uuid) TO service_role;

-- 3. Intake generation rotation ---------------------------------------------
CREATE OR REPLACE FUNCTION public.encounter_intake(_character_id uuid, _creature_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_node uuid;
  v_hp integer;
  v_enc uuid;
  v_party uuid;
  v_creatures uuid[];
BEGIN
  SELECT current_node_id, hp INTO v_node, v_hp
  FROM public.characters WHERE id = _character_id;

  IF v_node IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_node');
  END IF;
  IF COALESCE(v_hp, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'character_dead');
  END IF;

  v_enc := public.encounter_for_node(v_node);
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  -- Participation generation: a fresh row, or a row that moves to another
  -- encounter, is a NEW visit and must not inherit the identity a telegraphed
  -- cast froze for the previous one. Someone who never left keeps theirs.
  INSERT INTO public.encounter_participants AS ep (encounter_id, character_id, last_action_at, generation)
  VALUES (v_enc, _character_id, now(), nextval('public.encounter_participation_generation_seq'))
  ON CONFLICT (character_id) DO UPDATE
     SET encounter_id = EXCLUDED.encounter_id,
         last_action_at = now(),
         generation = CASE
           -- A different encounter is plainly a new visit.
           WHEN ep.encounter_id IS DISTINCT FROM EXCLUDED.encounter_id
             THEN nextval('public.encounter_participation_generation_seq')
           -- Same encounter, but the row was left behind by a departure that
           -- never reached the server (browser closed, RPC failed, trigger
           -- skipped): the row is only a CONTINUOUS visit if it was refreshed
           -- recently enough that the character cannot have been elsewhere.
           WHEN ep.last_action_at < now() - interval '3 seconds'
             AND NOT EXISTS (
               SELECT 1 FROM public.encounter_participants ep2
               WHERE ep2.character_id = _character_id
                 AND ep2.encounter_id = v_enc
                 AND ep2.last_action_at >= now() - interval '3 seconds')
             THEN nextval('public.encounter_participation_generation_seq')
           ELSE ep.generation
         END;

  -- Every living creature at the node belongs to the node's encounter.
  INSERT INTO public.encounter_creatures (encounter_id, creature_id)
  SELECT v_enc, c.id
  FROM public.creatures c
  WHERE c.node_id = v_node AND c.is_alive = true
  ON CONFLICT (creature_id) DO UPDATE SET encounter_id = EXCLUDED.encounter_id;

  SELECT party_id INTO v_party
  FROM public.party_members
  WHERE character_id = _character_id AND status = 'active'
  LIMIT 1;

  -- Requested engagements, filtered to creatures that are really here.
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v_creatures
  FROM public.creatures c
  WHERE c.id = ANY(COALESCE(_creature_ids, '{}'::uuid[]))
    AND c.node_id = v_node
    AND c.is_alive = true;

  IF array_length(v_creatures, 1) > 0 THEN
    INSERT INTO public.encounter_engagements (encounter_id, creature_id, character_id, party_id_at_join)
    SELECT v_enc, cid, _character_id, v_party
    FROM unnest(v_creatures) AS cid
    ON CONFLICT (encounter_id, creature_id, character_id)
    DO UPDATE SET last_action_at = now();
  END IF;

  UPDATE public.encounters
     SET last_activity_at = now()
   WHERE id = v_enc;

  RETURN jsonb_build_object(
    'ok', true,
    'encounter_id', v_enc,
    'node_id', v_node,
    'engaged_creature_ids', COALESCE(v_creatures, '{}'::uuid[])
  );
END;
$function$;

-- 4. Spawn-fenced durable recovery -------------------------------------------
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
        'joinedAtMs', (extract(epoch from COALESCE(ep.joined_at, c.created_at)) * 1000)::bigint,
        -- Participation generation: the identity a telegraphed cast freezes.
        -- 0 means "no live participation row" (a fled attribution-only source),
        -- which can never match a frozen roster entry.
        'generation', COALESCE(ep.generation, 0),
        -- Target eligibility: only characters standing on the encounter node
        -- can be hit, healed, or caught by a telegraphed cast. Never derived
        -- from delivery/RLS grace.
        'presentAtNode', (c.current_node_id = v_enc.node_id),
        'rowVersion', extract(epoch from COALESCE(ep.joined_at, c.created_at))::bigint,
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
      ) ORDER BY COALESCE(ep.joined_at, c.created_at), c.id)
      FROM public.encounter_attribution_roster(_encounter_id) r
      JOIN public.characters c ON c.id = r.character_id
      LEFT JOIN public.encounter_participants ep
        ON ep.encounter_id = _encounter_id AND ep.character_id = c.id
      -- Presence, not participation: a character who walked off the node is not
      -- a legal target for anything resolved here (telegraphed casts included),
      -- even while their delivery/RLS grace still lets them watch the fight.
      ), '[]'::jsonb),
    'creatures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'name', cr.name, 'level', cr.level, 'rarity', cr.rarity,
        'hp', cr.hp, 'maxHp', cr.max_hp, 'ac', cr.ac, 'isAlive', cr.is_alive,
        'spawnSeq', cr.spawn_seq, 'isHumanoid', cr.is_humanoid,
        'attrs', jsonb_build_object('str', 10, 'dex', 10, 'con', 10, 'int', 10, 'wis', 10, 'cha', 10) || COALESCE(cr.stats, '{}'::jsonb), 'lootMode', COALESCE(cr.loot_mode, 'legacy_table'),
        'lootTableId', cr.loot_table_id, 'lootTable', cr.loot_table,
        'bossCast', cr.boss_cast,
        -- Presentation-only boss flavor (crit prose pool + death cry). Never read
        -- by the simulation; carried so the client can narrate the blow.
        'bossCritFlavors', COALESCE(cr.boss_crit_flavors, '[]'::jsonb),
        'bossDeathCry', COALESCE(cr.boss_death_cry, ''),
        'configuredStoredPowerCap',
          COALESCE(NULLIF((cr.boss_cast #>> '{stored_power,cap}')::numeric, 0), 0),
        -- Durable telegraph recovery: the cast froze its own readiness boundary
        -- when the channel began, so the start gate survives restarts, catch-up
        -- and lease retries instead of living only in per-tick memory.
        -- Spawn fencing: a recovery boundary belongs to the spawn that froze
        -- it. A creature that has since died and respawned starts Ready, so a
        -- resolved row from a previous life cannot silence the new one.
        -- `max()` keeps the newest boundary authoritative; an older row can
        -- never lower it.
        'castReadyAtMs', COALESCE((
          SELECT max(COALESCE((ce.payload #>> '{config,readyAtMs}')::bigint, 0))
          FROM public.encounter_cast_events ce
          WHERE ce.encounter_id = _encounter_id
            AND ce.creature_id = cr.id
            AND ce.started_at >= COALESCE(cr.died_at, ce.started_at)), 0),
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
        'mechanic', ae.mechanic, 'magnitude', ae.magnitude,
        'remaining', ae.remaining, 'params', COALESCE(ae.params, '{}'::jsonb),
        'paramsVersion', ae.params_version, 'lifetime', ae.lifetime,
        'rowVersion', (extract(epoch from ae.created_at) * 1000)::bigint)
        ORDER BY ae.id)
      FROM public.active_effects ae
      WHERE ae.target_id IN (
        SELECT r.character_id FROM public.encounter_attribution_roster(_encounter_id) r
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
-- 5. Close unresolved legacy casts -------------------------------------------
-- Any cast still in flight at deployment predates frozen rosters. The resolver
-- fails such a cast safely as cancelled, but closing them here means no live
-- encounter carries one at all. Historical resolved rows are untouched.
UPDATE public.encounter_cast_events
SET resolved_at = now(),
    payload = COALESCE(payload, '{}'::jsonb)
              || jsonb_build_object('outcome', 'cancelled',
                                    'outcomeReason', 'legacy_no_roster')
WHERE resolved_at IS NULL
  AND (payload #> '{config,frozenRoster}') IS NULL;
