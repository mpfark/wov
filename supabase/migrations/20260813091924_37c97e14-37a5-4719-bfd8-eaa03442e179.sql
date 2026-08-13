-- ─────────────────────────────────────────────────────────────
-- C2: atomic commit backend. Combat remains in maintenance mode.
-- ─────────────────────────────────────────────────────────────

-- 1. Creature spawn generation ------------------------------------------------
ALTER TABLE public.creatures
  ADD COLUMN IF NOT EXISTS spawn_seq integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_creature_spawn_seq()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only a dead -> alive transition is a respawn.
  IF OLD.is_alive = false AND NEW.is_alive = true THEN
    NEW.spawn_seq := COALESCE(OLD.spawn_seq, 1) + 1;
  ELSE
    NEW.spawn_seq := COALESCE(OLD.spawn_seq, 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS creatures_bump_spawn_seq ON public.creatures;
CREATE TRIGGER creatures_bump_spawn_seq
  BEFORE UPDATE OF is_alive ON public.creatures
  FOR EACH ROW EXECUTE FUNCTION public.bump_creature_spawn_seq();

-- 2. Stable death occurrence id ----------------------------------------------
CREATE OR REPLACE FUNCTION public.encounter_death_id(
  _encounter_id uuid, _creature_id uuid, _spawn_seq integer, _tick bigint
)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT md5(
    _encounter_id::text || ':' || _creature_id::text || ':' ||
    COALESCE(_spawn_seq, 1)::text || ':' || _tick::text
  )::uuid
$$;

-- 3. Idempotency ledgers ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.encounter_kill_awards (
  death_id uuid NOT NULL,
  character_id uuid NOT NULL,
  award_kind text NOT NULL,
  encounter_id uuid NOT NULL,
  creature_id uuid NOT NULL,
  spawn_seq integer NOT NULL,
  tick_number bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (death_id, character_id, award_kind)
);
GRANT SELECT ON public.encounter_kill_awards TO authenticated;
GRANT ALL ON public.encounter_kill_awards TO service_role;
ALTER TABLE public.encounter_kill_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Players read their own kill awards" ON public.encounter_kill_awards;
CREATE POLICY "Players read their own kill awards"
  ON public.encounter_kill_awards FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = encounter_kill_awards.character_id AND c.user_id = auth.uid()
  ));
CREATE INDEX IF NOT EXISTS idx_kill_awards_encounter
  ON public.encounter_kill_awards (encounter_id, tick_number);

CREATE TABLE IF NOT EXISTS public.encounter_death_loot (
  death_id uuid PRIMARY KEY,
  encounter_id uuid NOT NULL,
  creature_id uuid NOT NULL,
  spawn_seq integer NOT NULL,
  tick_number bigint NOT NULL,
  mode text NOT NULL,
  loot_table_id uuid,
  item_id uuid,
  drop_chance numeric NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.encounter_death_loot TO authenticated;
GRANT ALL ON public.encounter_death_loot TO service_role;
ALTER TABLE public.encounter_death_loot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated may read death loot" ON public.encounter_death_loot;
CREATE POLICY "Authenticated may read death loot"
  ON public.encounter_death_loot FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_death_loot_encounter
  ON public.encounter_death_loot (encounter_id, tick_number);

-- 4. Scoped, per-domain state digest -----------------------------------------
-- _scope carries the EXACT row ids the snapshot included. Every domain hash is
-- parameterised by those ids, so rows created after the snapshot (new actions,
-- new participants, new engagements, new effects) cannot invalidate this tick;
-- they become eligible on the next one. A snapshotted row that changed,
-- vanished or was consumed DOES change its domain hash -> state_conflict.
CREATE OR REPLACE FUNCTION public.encounter_state_digest(
  _encounter_id uuid, _scope jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  ids AS (
    SELECT
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'participantIds', '[]'::jsonb)) x), '{}'::uuid[]) AS part_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'creatureIds', '[]'::jsonb)) x), '{}'::uuid[]) AS creat_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'actionIds', '[]'::jsonb)) x), '{}'::uuid[]) AS act_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'effectIds', '[]'::jsonb)) x), '{}'::uuid[]) AS eff_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'inventoryIds', '[]'::jsonb)) x), '{}'::uuid[]) AS inv_ids,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'castIds', '[]'::jsonb)) x), '{}'::uuid[]) AS cast_ids,
      COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(
        COALESCE(_scope->'engagementPairs', '[]'::jsonb)) x), '{}'::text[]) AS eng_pairs,
      COALESCE((SELECT array_agg(x::uuid) FROM jsonb_array_elements_text(
        COALESCE(_scope->'lootTableIds', '[]'::jsonb)) x), '{}'::uuid[]) AS loot_ids
  ),
  enc AS (SELECT * FROM public.encounters WHERE id = _encounter_id),
  parts AS (
    SELECT string_agg(ep.character_id::text || ':' ||
             extract(epoch from ep.joined_at)::bigint::text, ',' ORDER BY ep.character_id) s
    FROM public.encounter_participants ep, ids
    WHERE ep.encounter_id = _encounter_id AND ep.character_id = ANY(ids.part_ids)
  ),
  chars AS (
    SELECT string_agg(
             c.id::text || ':' || c.hp || '/' || c.max_hp || ':' || c.cp || '/' || c.max_cp ||
             ':' || c.mp || '/' || c.max_mp || ':' || c.level || ':' || c.xp || ':' || c.gold ||
             ':' || COALESCE(c.bhp, 0) || ':' || COALESCE(c.rp_total_earned, 0) ||
             ':' || COALESCE(c.current_node_id::text, '-'), ',' ORDER BY c.id) s
    FROM public.characters c, ids WHERE c.id = ANY(ids.part_ids)
  ),
  creats AS (
    SELECT string_agg(
             cr.id::text || ':' || cr.hp || '/' || cr.max_hp || ':' || cr.is_alive::text ||
             ':' || cr.spawn_seq || ':' || COALESCE(cr.drop_chance::text, '-') ||
             ':' || COALESCE(cr.loot_mode, '-') || ':' || COALESCE(cr.loot_table_id::text, '-'),
             ',' ORDER BY cr.id) s
    FROM public.creatures cr, ids WHERE cr.id = ANY(ids.creat_ids)
  ),
  engs AS (
    SELECT string_agg(e.creature_id::text || '>' || e.character_id::text || ':' ||
             COALESCE(e.party_id_at_join::text, '-'), ',' ORDER BY e.creature_id, e.character_id) s
    FROM public.encounter_engagements e, ids
    WHERE e.encounter_id = _encounter_id
      AND (e.creature_id::text || '>' || e.character_id::text) = ANY(ids.eng_pairs)
  ),
  acts AS (
    SELECT string_agg(a.id::text || ':' || a.status || ':' || a.client_seq || ':' ||
             a.ability_key || ':' || COALESCE(a.target_creature_id::text, '-') || ':' ||
             COALESCE(a.target_character_id::text, '-') || ':' ||
             COALESCE(a.eligible_after_ms::text, '-'), ',' ORDER BY a.id) s
    FROM public.combat_actions a, ids WHERE a.id = ANY(ids.act_ids)
  ),
  effs AS (
    SELECT string_agg(ae.id::text || ':' || ae.stacks || ':' || ae.damage_per_tick ||
             ':' || ae.expires_at || ':' || COALESCE(ae.next_tick_at::text, '-'), ','
             ORDER BY ae.id) s
    FROM public.active_effects ae, ids WHERE ae.id = ANY(ids.eff_ids)
  ),
  equip AS (
    SELECT string_agg(ci.id::text || ':' || ci.current_durability || ':' ||
             COALESCE(ci.equipped_slot::text, '-') || ':' || ci.item_id::text, ','
             ORDER BY ci.id) s
    FROM public.character_inventory ci, ids WHERE ci.id = ANY(ids.inv_ids)
  ),
  casts AS (
    SELECT string_agg(ce.id::text || ':' || COALESCE(ce.cast_key, '-') || ':' ||
             COALESCE(extract(epoch from ce.started_at)::bigint::text, '-') || ':' ||
             COALESCE(extract(epoch from ce.resolved_at)::bigint::text, '-') || ':' ||
             md5(ce.payload::text), ',' ORDER BY ce.id) s
    FROM public.encounter_cast_events ce, ids WHERE ce.id = ANY(ids.cast_ids)
  ),
  cfg AS (
    SELECT md5(
      COALESCE((SELECT row_to_json(n.*)::text FROM public.loot_pool_config n LIMIT 1), '') || '|' ||
      COALESCE((SELECT string_agg(s.key || ':' || md5(to_jsonb(s.*)::text), ',' ORDER BY s.key)
                FROM public.applied_statuses s), '') || '|' ||
      COALESCE((SELECT string_agg(cc.key || '=' || cc.value, ',' ORDER BY cc.key)
                FROM public.combat_config cc), '') || '|' ||
      COALESCE((SELECT string_agg(w.id::text || ':' || md5(to_jsonb(w.*)::text), ',' ORDER BY w.id)
                FROM public.weapon_progression_config w), '') || '|' ||
      COALESCE((SELECT string_agg(b.id::text || ':' || md5(to_jsonb(b.*)::text), ',' ORDER BY b.id)
                FROM public.xp_boost b), '') || '|' ||
      COALESCE((SELECT string_agg(lte.id::text || ':' || lte.item_id::text || ':' || lte.weight, ','
                                  ORDER BY lte.id)
                FROM public.loot_table_entries lte, ids
                WHERE lte.loot_table_id = ANY(ids.loot_ids)), '')
    ) h
  )
  SELECT jsonb_build_object(
    'participants', md5(COALESCE((SELECT s FROM parts), '')),
    'characters',   md5(COALESCE((SELECT s FROM chars), '')),
    'creatures',    md5(COALESCE((SELECT s FROM creats), '')),
    'engagements',  md5(COALESCE((SELECT s FROM engs), '')),
    'actions',      md5(COALESCE((SELECT s FROM acts), '')),
    'effects',      md5(COALESCE((SELECT s FROM effs), '')),
    'equipment',    md5(COALESCE((SELECT s FROM equip), '')),
    'casts',        md5(COALESCE((SELECT s FROM casts), '')),
    'storedPower',  md5(COALESCE((SELECT e.stored_power || ':' || COALESCE(e.stored_power_cap::text, '-') ||
                                  ':' || COALESCE(e.stored_power_source_id::text, '-') FROM enc e), '')),
    'configVersion', (SELECT h FROM cfg)
  )
$$;

-- 5. Snapshot loader ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encounter_snapshot_v2(
  _encounter_id uuid, _claim_token uuid, _tick bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_cfg public.loot_pool_config;
  v_fallback numeric := 0.5;   -- LOOT_FALLBACK_CHANCE (legacy value, explicit)
  v_out jsonb;
  v_scope jsonb;
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
    'snapshotVersion', 2,
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
        'intervalMs', ae.tick_rate_ms, 'lastTickAtMs', ae.next_tick_at,
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
    'loadedAtMs', v_now
  ) INTO v_scope;

  RETURN v_out
    || jsonb_build_object('scope', v_scope)
    || jsonb_build_object('stateDigest', public.encounter_state_digest(_encounter_id, v_scope));
END;
$$;

-- 6. Safe claim release (diagnostic reason only) ------------------------------
CREATE OR REPLACE FUNCTION public.release_encounter_tick(
  _encounter_id uuid, _tick bigint, _claim_token uuid, _reason text DEFAULT 'resolver_error'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc public.encounters;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));
  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id FOR UPDATE;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'no_encounter');
  END IF;
  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token THEN
    RETURN jsonb_build_object('released', false, 'reason', 'stale_claim');
  END IF;

  -- Ownership only. No combat state, no cursor advance. _reason is never stored.
  UPDATE public.encounters
  SET tick_state = 'idle', resolving_tick = NULL, claim_token = NULL,
      resolver_id = NULL, lease_until = NULL, attempt = 0
  WHERE id = _encounter_id;

  RETURN jsonb_build_object('released', true, 'tick', _tick, 'diagnostic_reason', _reason);
END;
$$;

-- 7. Bounded background batch cleanup (never called inside a tick) ------------
CREATE OR REPLACE FUNCTION public.prune_encounter_tick_batches(
  _older_than_seconds integer DEFAULT 180, _limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain integer := GREATEST(180, COALESCE(_older_than_seconds, 180));
  v_deleted integer;
BEGIN
  WITH victims AS (
    SELECT b.encounter_id, b.tick_number
    FROM public.encounter_tick_batches b
    JOIN public.encounters e ON e.id = b.encounter_id
    WHERE b.created_at < now() - make_interval(secs => v_retain)
      AND b.tick_number < e.tick_number          -- never the newest, recoverable tick
    ORDER BY b.created_at
    LIMIT GREATEST(1, COALESCE(_limit, 500))
  )
  DELETE FROM public.encounter_tick_batches d
  USING victims v
  WHERE d.encounter_id = v.encounter_id AND d.tick_number = v.tick_number;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  DELETE FROM public.encounter_tick_batches b
  WHERE b.created_at < now() - make_interval(secs => v_retain)
    AND NOT EXISTS (SELECT 1 FROM public.encounters e WHERE e.id = b.encounter_id);

  RETURN v_deleted;
END;
$$;

-- 8. Atomic commit ------------------------------------------------------------
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
    SELECT 'unknown_character:' || x.character_id AS msg
    FROM jsonb_to_recordset(COALESCE(_proposed->'characters', '[]'::jsonb))
         AS x(character_id uuid, "hpBefore" integer, "hpAfter" integer,
              "cpAfter" integer, "mpAfter" integer)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_participants ep
                      WHERE ep.encounter_id = _encounter_id AND ep.character_id = x.character_id)
    UNION ALL
    SELECT 'character_bounds:' || x.character_id
    FROM jsonb_to_recordset(COALESCE(_proposed->'characters', '[]'::jsonb))
         AS x(character_id uuid, "hpBefore" integer, "hpAfter" integer,
              "cpAfter" integer, "mpAfter" integer)
    JOIN public.characters c ON c.id = x.character_id
    WHERE x."hpAfter" < 0 OR x."hpAfter" > c.max_hp
       OR x."cpAfter" < 0 OR x."cpAfter" > c.max_cp
       OR COALESCE(x."mpAfter", c.mp) < 0 OR COALESCE(x."mpAfter", c.mp) > c.max_mp
       OR x."hpBefore" IS DISTINCT FROM c.hp
    UNION ALL
    SELECT 'unknown_creature:' || y.creature_id
    FROM jsonb_to_recordset(COALESCE(_proposed->'creatures', '[]'::jsonb))
         AS y(creature_id uuid, "spawnSeq" integer, "hpBefore" integer, "hpAfter" integer, killed boolean)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_creatures ec
                      WHERE ec.encounter_id = _encounter_id AND ec.creature_id = y.creature_id)
    UNION ALL
    SELECT 'creature_bounds:' || y.creature_id
    FROM jsonb_to_recordset(COALESCE(_proposed->'creatures', '[]'::jsonb))
         AS y(creature_id uuid, "spawnSeq" integer, "hpBefore" integer, "hpAfter" integer, killed boolean)
    JOIN public.creatures cr ON cr.id = y.creature_id
    WHERE y."hpAfter" < 0 OR y."hpAfter" > cr.max_hp
       OR y."hpBefore" IS DISTINCT FROM cr.hp
       OR y."spawnSeq" IS DISTINCT FROM cr.spawn_seq
    UNION ALL
    SELECT 'reward_bounds:' || r.character_id
    FROM jsonb_to_recordset(COALESCE(_proposed->'rewards', '[]'::jsonb))
         AS r(character_id uuid, "deathId" uuid, xp integer, gold integer, renown integer,
              "levelAfter" integer)
    WHERE r.xp < 0 OR r.gold < 0 OR r.renown < 0
       OR COALESCE(r."levelAfter", 1) < 1 OR COALESCE(r."levelAfter", 1) > 42
       OR r."deathId" IS NULL
    UNION ALL
    SELECT 'unknown_reward_recipient:' || r.character_id
    FROM jsonb_to_recordset(COALESCE(_proposed->'rewards', '[]'::jsonb))
         AS r(character_id uuid, "deathId" uuid)
    WHERE NOT EXISTS (SELECT 1 FROM public.encounter_participants ep
                      WHERE ep.encounter_id = _encounter_id AND ep.character_id = r.character_id)
    UNION ALL
    SELECT 'durability:' || d."inventoryId"
    FROM jsonb_to_recordset(COALESCE(_proposed->'durability', '[]'::jsonb))
         AS d(character_id uuid, "inventoryId" uuid, "durabilityAfter" integer)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.character_inventory ci
      WHERE ci.id = d."inventoryId" AND ci.character_id = d.character_id
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

  -- fixed column list; no dynamic SQL, unknown payload keys are ignored
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

  -- loot: one record per death. Explicit items land on the ground; pool-mode
  -- intents are recorded unresolved for the C3 pool resolver.
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
        stored_power_source_id = COALESCE((v_item->>'sourceId')::uuid, stored_power_source_id)
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

  -- durable actions: every snapshotted pending action becomes terminal
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

GRANT EXECUTE ON FUNCTION public.encounter_snapshot_v2(uuid, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick_v2(uuid, bigint, uuid, uuid, integer, integer, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_encounter_tick(uuid, bigint, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_encounter_tick_batches(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.encounter_state_digest(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.encounter_death_id(uuid, uuid, integer, bigint) TO service_role;