/**
 * c5-final-validation — deployed evidence for the final pre-soak gate.
 *
 * Overlord-only. Combat stays in global maintenance: every tick runs through
 * the ordinary `combat_soak_access` allowlist, scoped to one throwaway
 * character on one throwaway node, and the allowlist is torn down in `finally`.
 *
 * Nothing here simulates anything by itself. Every tick is
 *   orchestrateCombatResolution
 *     -> encounter claim
 *     -> encounter_snapshot_v2 (strict projection, incl. `lifetime`)
 *     -> decodeEncounterSnapshot (strict decode)
 *     -> resolveTickPure
 *     -> commit_encounter_tick_v2
 * so an assertion about "the next snapshot" is an assertion about what the
 * deployed chain actually persisted and re-read.
 *
 * Sections (`?section=`), run separately to stay inside the request budget:
 *   stance       — stance reconstruction, lifetime, stacks, cancellation,
 *                  replacement, death, class change, dispel, effects-only.
 *   power        — Stored Power bank -> assignment -> consume -> commit.
 *   effectsonly  — deployed effects-only counters.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';
import { corsHeaders } from '../_shared/http.ts';
import { orchestrateCombatResolution } from '../_shared/combat/c3/orchestration.ts';
import { buildAbilityCatalog } from '../_shared/combat/c3-catalog.ts';

/** The stance no-expiry sentinel (Number.MAX_SAFE_INTEGER). */
const STANCE_NO_EXPIRY_MS = 9007199254740991;

interface CaseResult { case: string; pass: boolean; detail?: unknown }
type Row = Record<string, unknown>;
type Sql = ReturnType<typeof postgres>;

interface TickOutcome {
  ok: boolean;
  tick?: number;
  mode?: string;
  events: { type: string; payload?: Record<string, unknown> }[];
  raw: unknown;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const url = Deno.env.get('SUPABASE_URL')!;
  const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const admin = createClient(url, srvKey, { auth: { persistSession: false } });

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: userData } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return json({ error: 'unauthenticated' }, 401);
  const { data: isOverlord } = await admin.rpc('has_role', { _user_id: uid, _role: 'overlord' });
  if (!isOverlord) return json({ error: 'forbidden' }, 403);

  // Stance RPCs are owner-scoped by design; the fixture characters belong to
  // the calling Overlord, so the harness drives the REAL client path.
  const asUser = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const section = new URL(req.url).searchParams.get('section') ?? 'stance';
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  const cases: CaseResult[] = [];
  const push = (name: string, pass: boolean, detail?: unknown) => cases.push({ case: name, pass, detail });

  const created: { nodeId?: string; otherNodeId?: string; charIds: string[]; creatureIds: string[] } = {
    charIds: [], creatureIds: [],
  };

  try {
    const catalog = await buildAbilityCatalog(admin);

    // ── shared fixture plumbing ──────────────────────────────────────────
    const [{ id: regionId }] = await sql<{ id: string }[]>`
      select id from public.regions order by created_at limit 1`;
    const [{ id: nodeId }] = await sql<{ id: string }[]>`
      insert into public.nodes (region_id, name, description, x, y)
      values (${regionId}, ${'c5-final-validation-' + section}, ${'isolated validation fixture'}, 99998, 99998)
      returning id`;
    created.nodeId = nodeId;
    const [{ id: otherNodeId }] = await sql<{ id: string }[]>`
      insert into public.nodes (region_id, name, description, x, y)
      values (${regionId}, ${'c5-final-validation-away-' + section}, ${'off-node fixture'}, 99997, 99997)
      returning id`;
    created.otherNodeId = otherNodeId;

    const makeChar = async (classKey: string, over: Partial<Record<string, number>> = {}) => {
      const [{ id }] = await sql<{ id: string }[]>`
        insert into public.characters
          (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, ac, current_node_id,
           str, dex, con, "int", wis, cha)
        values (${uid}, ${'Val' + Math.floor(Math.random() * 1_000_000)}, 'human', ${classKey},
                20, ${over.hp ?? 4000}, 4000, 400, 400, 300, 300, ${over.ac ?? 30}, ${nodeId},
                14, 14, 14, 18, 18, 12)
        returning id`;
      created.charIds.push(id);
      return id;
    };
    const makeCreature = async (o: {
      name: string; aggressive?: boolean; hp?: number; bossCast?: unknown; level?: number;
    }) => {
      const [{ id }] = await sql<{ id: string }[]>`
        insert into public.creatures
          (name, description, node_id, level, hp, max_hp, ac, is_aggressive, is_alive, stats, boss_cast)
        values (${o.name}, ${'validation fixture'}, ${nodeId}, ${o.level ?? 20}, ${o.hp ?? 20000},
                ${o.hp ?? 20000}, 5, ${o.aggressive ?? false}, true,
                ${sql.json({ str: 12, dex: 10, con: 12, int: 8, wis: 8, cha: 8 })},
                ${o.bossCast ? sql.json(o.bossCast as Record<string, unknown>) : null})
        returning id`;
      created.creatureIds.push(id);
      return id;
    };

    const openSoak = async (charId: string) => {
      await sql`insert into public.combat_soak_access (character_id, node_id, expires_at, note)
                values (${charId}, ${nodeId}, now() + interval '10 minutes', 'c5-final-validation')`;
      await sql`insert into public.combat_config (key, value) values ('combat_soak', 'on')
                on conflict (key) do update set value = 'on'`;
    };

    const effectsOf = (target?: string) =>
      target
        ? sql<Row[]>`select * from public.active_effects where node_id = ${nodeId} and target_id = ${target} order by effect_type`
        : sql<Row[]>`select * from public.active_effects where node_id = ${nodeId} order by effect_type`;

    /** One real tick. Retries only the cadence refusal, never a real failure. */
    const tick = async (
      role: 'live' | 'catchup',
      characterId: string,
      creatureIds: string[],
    ): Promise<TickOutcome> => {
      let res: Record<string, unknown> | null = null;
      for (let i = 0; i < 14; i++) {
        res = await orchestrateCombatResolution(
          { role, characterId, creatureIds, ...(role === 'catchup' ? { nodeId } : {}) },
          {
            db: admin, nowMs: Date.now(), catalog,
            refreshCatalog: () => buildAbilityCatalog(admin, true),
            newBatchId: () => crypto.randomUUID(), caller: 'c5-final-validation',
          },
        ) as unknown as Record<string, unknown>;
        if (res.ok === true) break;
        if (res.reason !== 'not_due') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const events = (res?.events ?? []) as TickOutcome['events'];
      return { ok: res?.ok === true, tick: res?.tick as number, mode: res?.mode as string, events, raw: res };
    };

    const stanceRows = (charId: string) =>
      sql<Row[]>`select * from public.active_effects
                 where target_id = ${charId} and lifetime = 'stance' order by effect_type`;
    const reservedOf = async (charId: string) => {
      const [r] = await sql<Row[]>`select reserved_buffs, stance_state, cp, hp from public.characters where id = ${charId}`;
      return r;
    };
    const batchesText = async () => {
      const rows = await sql<Row[]>`
        select to_jsonb(t.*)::text as body from public.encounter_tick_batches t
        where t.encounter_id in (select id from public.encounters where node_id = ${nodeId})`;
      return rows.map((r) => String(r.body)).join('\n');
    };

    // ══════════════════════════════════════════════════════════════════════
    if (section === 'stance') {
      const wizard = await makeChar('wizard');
      const assassin = await makeChar('assassin');
      const dummy = await makeCreature({ name: 'Validation Effigy' });
      await openSoak(wizard);
      await openSoak(assassin);
      await admin.rpc('encounter_ensure_for_character', { _character_id: wizard });
      await admin.rpc('encounter_intake', { _character_id: wizard, _creature_ids: [dummy] });
      await admin.rpc('encounter_intake', { _character_id: assassin, _creature_ids: [dummy] });

      // ── activation through the real owner-scoped RPC ────────────────────
      const act = await asUser.rpc('activate_stance', {
        p_character_id: wizard, p_stance_key: 'force_shield', p_tier: 1,
      });
      const actIgnite = await asUser.rpc('activate_stance', {
        p_character_id: wizard, p_stance_key: 'ignite', p_tier: 3,
      });
      push('activation_reserves_cp_without_semantic_row',
        !act.error && !actIgnite.error && (await stanceRows(wizard)).length === 0,
        { reserved: (await reservedOf(wizard)).reserved_buffs, error: act.error ?? actIgnite.error });

      const before = await reservedOf(wizard);
      const t1 = await tick('live', wizard, [dummy]);
      const rows1 = await stanceRows(wizard);
      const after = await reservedOf(wizard);

      push('reconstructed_once_per_reserved_stance',
        t1.ok && rows1.length === 2 &&
        rows1.every((r) => r.source_id === r.target_id && Number(r.expires_at) === STANCE_NO_EXPIRY_MS),
        { tick: t1.tick, rows: rows1.map((r) => ({ e: r.effect_type, m: r.mechanic, exp: r.expires_at, rem: r.remaining })) });

      push('reconstruction_costs_no_cp',
        JSON.stringify(after.reserved_buffs) === JSON.stringify(before.reserved_buffs) &&
        Number(after.cp) >= Number(before.cp),
        { cp_before: before.cp, cp_after: after.cp, reserved: after.reserved_buffs });

      const [{ n: pendingActions }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.combat_actions where character_id = ${wizard}`;
      const batchBody = await batchesText();
      push('reconstruction_acknowledges_no_client_action',
        pendingActions === 0 && !batchBody.includes('stance:'),
        { pending_actions: pendingActions, batch_mentions_stance_intent: batchBody.includes('stance:') });

      // ── duplicate / reclaimed resolution ────────────────────────────────
      const idsBefore = rows1.map((r) => String(r.id)).sort();
      const t2 = await tick('live', wizard, [dummy]);
      const rows2 = await stanceRows(wizard);
      push('duplicate_tick_creates_no_duplicate_stance_row',
        t2.ok && rows2.length === 2 &&
        JSON.stringify(rows2.map((r) => String(r.id)).sort()) === JSON.stringify(idsBefore),
        { ids_before: idsBefore, ids_after: rows2.map((r) => String(r.id)).sort() });

      let dupRefused = false;
      try {
        await sql`insert into public.active_effects
          (node_id, target_id, source_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at,
           tick_rate_ms, source_ability_key, mechanic, magnitude, remaining, params, params_version, lifetime)
          values (${nodeId}, ${wizard}, ${wizard}, 'force_shield', 1, 0, ${Date.now()},
                  ${STANCE_NO_EXPIRY_MS}, 2000, 'force_shield', 'absorb_buff', 10, 10,
                  ${sql.json({})}, 1, 'stance')`;
      } catch { dupRefused = true; }
      push('database_refuses_a_second_row_for_the_same_stance', dupRefused &&
        (await stanceRows(wizard)).length === 2);

      push('stance_lifetime_stays_no_expiry_across_later_snapshots',
        rows2.every((r) => r.lifetime === 'stance' && Number(r.expires_at) === STANCE_NO_EXPIRY_MS),
        rows2.map((r) => ({ e: r.effect_type, lifetime: r.lifetime, expires_at: r.expires_at })));

      // ── target stacks: finite, independent of the stance ────────────────
      for (let i = 0; i < 4; i++) await tick('live', wizard, [dummy]);
      const actEnv = await asUser.rpc('activate_stance', {
        p_character_id: assassin, p_stance_key: 'envenom', p_tier: 3,
      });
      for (let i = 0; i < 4; i++) await tick('live', assassin, [dummy]);
      const creatureEffects = await effectsOf(dummy);
      const stacks = creatureEffects.filter((r) => String(r.effect_type).endsWith('_stack'));
      push('ignite_and_envenom_apply_target_stacks',
        stacks.length > 0 && !actEnv.error,
        { stacks: stacks.map((r) => ({ e: r.effect_type, src: r.source_id === assassin ? 'assassin' : 'wizard', stacks: r.stacks })) });
      push('target_stacks_keep_a_finite_lifetime_of_their_own',
        stacks.length > 0 && stacks.every((r) => r.lifetime === 'timed' && Number(r.expires_at) < STANCE_NO_EXPIRY_MS),
        stacks.map((r) => ({ e: r.effect_type, lifetime: r.lifetime, expires_in_ms: Number(r.expires_at) - Date.now() })));

      // ── mutual exclusion / replacement ──────────────────────────────────
      const mutex = await asUser.rpc('activate_stance', {
        p_character_id: assassin, p_stance_key: 'ignite', p_tier: 3,
      });
      push('mutually_exclusive_stance_is_refused', !!mutex.error, { error: mutex.error?.message });

      await asUser.rpc('drop_stance', { p_character_id: assassin, p_stance_key: 'envenom' });
      const envAfterDrop = await stanceRows(assassin);
      const reAct = await asUser.rpc('activate_stance', {
        p_character_id: assassin, p_stance_key: 'eagle_eye', p_tier: 1,
      });
      push('replacement_releases_the_previous_stance_only',
        envAfterDrop.length === 0 && !reAct.error &&
        !JSON.stringify((await reservedOf(assassin)).reserved_buffs).includes('envenom'),
        { rows_after_drop: envAfterDrop.length, reserved: (await reservedOf(assassin)).reserved_buffs });

      // eagle_eye is not a ranger-agnostic ability: an assassin cannot resolve
      // its configuration, so no semantic row may appear for it.
      await tick('live', assassin, [dummy]);
      const invalid = (await stanceRows(assassin)).filter((r) => r.effect_type === 'eagle_eye');
      push('class_change_or_foreign_stance_cannot_materialise',
        invalid.length === 0, { rows: invalid.length });
      await asUser.rpc('drop_stance', { p_character_id: assassin, p_stance_key: 'eagle_eye' });

      // ── explicit cancellation ───────────────────────────────────────────
      await asUser.rpc('drop_stance', { p_character_id: wizard, p_stance_key: 'ignite' });
      const afterCancel = await stanceRows(wizard);
      push('cancellation_removes_reservation_and_semantic_effect',
        afterCancel.length === 1 && afterCancel[0].effect_type === 'force_shield' &&
        !JSON.stringify((await reservedOf(wizard)).reserved_buffs).includes('ignite'),
        { rows: afterCancel.map((r) => r.effect_type), reserved: (await reservedOf(wizard)).reserved_buffs });

      // ── dispel vs reservation authority ─────────────────────────────────
      await sql`delete from public.active_effects where target_id = ${wizard} and lifetime = 'stance'`;
      const tCatch = await tick('catchup', wizard, []);
      const afterCatchup = await stanceRows(wizard);
      push('effects_only_never_reconstructs_a_stance',
        afterCatchup.length === 0 && tCatch.mode !== 'live',
        { rows: afterCatchup.length, mode: tCatch.mode, ok: tCatch.ok });

      await tick('live', wizard, [dummy]);
      const afterLive = await stanceRows(wizard);
      push('reservation_is_the_single_authority_row_is_reconstructed',
        afterLive.length === 1, { rows: afterLive.map((r) => r.effect_type) });

      // ── depleted absorb stance ──────────────────────────────────────────
      await sql`update public.active_effects set remaining = 0
                where target_id = ${wizard} and effect_type = 'force_shield'`;
      await tick('live', wizard, [dummy]);
      const depleted = await stanceRows(wizard);
      push('depleted_absorb_stance_stays_active_but_empty',
        depleted.length === 1 && Number(depleted[0].remaining) === 0,
        { remaining: depleted[0]?.remaining, magnitude: depleted[0]?.magnitude });

      const regen = await asUser.rpc('apply_force_shield_regen', { _character_id: wizard });
      const afterRegen = await stanceRows(wizard);
      push('out_of_combat_regeneration_refills_the_authoritative_pool',
        Number(afterRegen[0]?.remaining ?? -1) >= 0 && !regen.error,
        { stance_state: regen.data, remaining: afterRegen[0]?.remaining, magnitude: afterRegen[0]?.magnitude });

      // ── death ───────────────────────────────────────────────────────────
      const killer = await makeCreature({ name: 'Validation Reaper', aggressive: true, hp: 20000, level: 30 });
      await sql`update public.characters set hp = 1, ac = 1 where id = ${wizard}`;
      await admin.rpc('encounter_intake', { _character_id: wizard, _creature_ids: [killer] });
      let died = false;
      for (let i = 0; i < 8 && !died; i++) {
        const t = await tick('live', wizard, [killer]);
        died = t.events.some((e) => e.type === 'character_died') ||
          Number((await reservedOf(wizard)).hp) <= 0;
      }
      const post = await reservedOf(wizard);
      push('death_ends_every_stance_and_releases_the_reservation',
        died && JSON.stringify(post.reserved_buffs ?? {}) === '{}' && (await stanceRows(wizard)).length === 0,
        { died, hp: post.hp, reserved: post.reserved_buffs, rows: (await stanceRows(wizard)).length });

      // ── no orphans anywhere ─────────────────────────────────────────────
      const [{ n: orphans }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.active_effects ae
        where ae.lifetime = 'stance'
          and not exists (select 1 from public.characters c
                          where c.id = ae.target_id
                            and coalesce(c.reserved_buffs, '{}'::jsonb) ? ae.effect_type)`;
      push('no_orphaned_stance_effect_anywhere_in_the_database', orphans === 0, { orphans });
    }

    // ══════════════════════════════════════════════════════════════════════
    if (section === 'power') {
      const primary = await makeChar('warrior');
      const secondary = await makeChar('warrior');
      await openSoak(primary);
      await openSoak(secondary);
      const bossCast = {
        ability_key: 'validation_nova', cast_key: 'validation_nova', label: 'Validation Nova',
        cast_ticks: 2, cooldown_ticks: 99, damage: 10, damage_aoe: 4, damage_type: 'fire',
        channeling: true, pause_autoattacks: true, target_mode: 'random_alive',
        stored_power: { cap: 400, primary_share: 1, aoe_share: 0.5, consume_mode: 'all' },
      };
      const boss = await makeCreature({ name: 'Validation Channeller', aggressive: true, bossCast, level: 30 });
      await admin.rpc('encounter_ensure_for_character', { _character_id: primary });
      await admin.rpc('encounter_intake', { _character_id: primary, _creature_ids: [boss] });
      await admin.rpc('encounter_intake', { _character_id: secondary, _creature_ids: [boss] });
      const { data: encId } = await admin.rpc('encounter_for_node', { _node_id: nodeId });
      const encounterId = String(encId);

      const seedCast = async (o: {
        consumeMode: string; consumePct?: number; consumeFixed?: number; dueMs: number;
        primaryShare?: number; aoeShare?: number; target: string; cap?: number;
      }) => {
        await sql`delete from public.encounter_cast_events where encounter_id = ${encounterId}`;
        const startedAt = new Date(Date.now() - 8000).toISOString();
        const expiresAt = new Date(Date.now() + o.dueMs).toISOString();
        const config = {
          label: 'Validation Nova', targetCharacterId: o.target, baseDamage: 10, baseAoeDamage: 4,
          damageType: 'fire', primaryShare: o.primaryShare ?? 1, aoeShare: o.aoeShare ?? 0.5,
          consumeMode: o.consumeMode, consumePct: o.consumePct ?? 100, consumeFixed: o.consumeFixed ?? 0,
          pauseAutoattacks: true, storedPowerCap: o.cap ?? 400, lockMs: 0, castedText: null,
        };
        await sql`insert into public.encounter_cast_events
          (encounter_id, node_id, creature_id, cast_key, ability_key, started_at, expires_at, payload)
          values (${encounterId}, ${nodeId}, ${boss}, 'validation_nova', 'validation_nova',
                  ${startedAt}, ${expiresAt}, ${sql.json({ config, stored_power: { cap: o.cap ?? 400 } })})`;
      };
      const setPool = async (n: number, cap = 400) => {
        await sql`update public.encounters set stored_power = ${n}, stored_power_cap = ${cap},
                    stored_power_source_id = ${boss} where id = ${encounterId}`;
      };
      const poolNow = async () => {
        const [r] = await sql<Row[]>`select stored_power, stored_power_cap from public.encounters where id = ${encounterId}`;
        return Number(r.stored_power);
      };

      const modes: { name: string; mode: string; pct?: number; fixed?: number; expectUsed: number; expectLeft: number }[] = [
        { name: 'all', mode: 'all', expectUsed: 100, expectLeft: 0 },
        { name: 'percent', mode: 'percent', pct: 50, expectUsed: 50, expectLeft: 50 },
        { name: 'fixed', mode: 'fixed', fixed: 30, expectUsed: 30, expectLeft: 70 },
        { name: 'preserve', mode: 'preserve', expectUsed: 100, expectLeft: 100 },
        { name: 'reset', mode: 'reset', expectUsed: 0, expectLeft: 0 },
      ];

      for (const m of modes) {
        await setPool(100);
        await seedCast({
          consumeMode: m.mode, consumePct: m.pct, consumeFixed: m.fixed,
          dueMs: -1000, target: primary,
        });
        const t = await tick('live', primary, [boss]);
        const hits = t.events.filter((e) => e.type === 'boss_cast_hit');
        const prim = hits.find((e) => e.payload?.characterId === primary);
        const aoe = hits.find((e) => e.payload?.characterId === secondary);
        const left = await poolNow();
        const expectPrimary = 10 + Math.floor(m.expectUsed * 1);
        const expectAoe = 4 + Math.floor(m.expectUsed * 0.5);
        push(`stored_power_${m.name}_consumes_and_commits`,
          t.ok && left === m.expectLeft &&
          Number(prim?.payload?.amount ?? -1) === expectPrimary,
          {
            pool_after: left, expected_left: m.expectLeft,
            primary_damage: prim?.payload?.amount, expected_primary: expectPrimary,
            aoe_damage: aoe?.payload?.amount, expected_aoe: expectAoe,
          });

        // Duplicate / reclaimed resolution: the cast is closed, so a second
        // tick may neither hit again nor move the pool.
        const t2 = await tick('live', primary, [boss]);
        const left2 = await poolNow();
        push(`stored_power_${m.name}_duplicate_resolution_is_inert`,
          t2.events.filter((e) => e.type === 'boss_cast_hit').length === 0 && left2 === left,
          { pool: left2, hits: t2.events.filter((e) => e.type === 'boss_cast_hit').length });
      }

      // Cap: banking during a channel may never exceed the configured cap.
      await setPool(390, 400);
      await seedCast({ consumeMode: 'all', dueMs: 30_000, target: primary, cap: 400 });
      await tick('live', primary, [boss]);
      const capped = await poolNow();
      push('stored_power_banking_respects_the_cap', capped <= 400, { pool: capped });

      // Flee / no eligible target: the pool still drains, nobody is hit.
      await setPool(100, 400);
      await seedCast({ consumeMode: 'all', dueMs: -1000, target: primary, cap: 400 });
      await sql`update public.characters set current_node_id = ${created.otherNodeId} where id in (${primary}, ${secondary})`;
      const tFlee = await tick('live', primary, [boss]);
      const fleeHits = tFlee.events.filter((e) => e.type === 'boss_cast_hit').length;
      const fleePool = await poolNow();
      push('stored_power_no_target_drains_without_damage',
        fleeHits === 0 && fleePool === 0,
        { hits: fleeHits, pool: fleePool, evaded: tFlee.events.some((e) => e.type === 'boss_cast_evaded') });
      await sql`update public.characters set current_node_id = ${nodeId} where id in (${primary}, ${secondary})`;
    }

    // ══════════════════════════════════════════════════════════════════════
    if (section === 'effectsonly') {
      const char = await makeChar('assassin');
      await openSoak(char);
      const victim = await makeCreature({ name: 'Validation Quarry', hp: 6, aggressive: true, level: 20 });
      await admin.rpc('encounter_ensure_for_character', { _character_id: char });
      await admin.rpc('encounter_intake', { _character_id: char, _creature_ids: [victim] });
      const { data: encId } = await admin.rpc('encounter_for_node', { _node_id: nodeId });
      const encounterId = String(encId);

      // Equipment, so a live-only durability change is possible at all.
      const [item] = await sql<Row[]>`select id from public.items limit 1`;
      if (item) {
        await sql`insert into public.character_inventory
                  (character_id, item_id, equipped_slot, current_durability, quantity)
                  values (${char}, ${item.id}, 'main_hand', 100, 1)`;
      }

      // An attributed damage-over-time that will kill the quarry offscreen.
      const now = Date.now();
      await sql`insert into public.active_effects
        (node_id, target_id, source_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at,
         tick_rate_ms, source_ability_key, mechanic, magnitude, params, params_version, damage_type)
        values (${nodeId}, ${victim}, ${char}, 'envenom_stack', 2, 5, ${now - 1}, ${now + 120_000},
                2000, 'envenom', 'dot_debuff', null, ${sql.json({ maxStacks: 5, damageType: 'poison' })}, 1, 'poison')`;

      // A pending client intent that effects-only may neither run nor reject.
      await sql`insert into public.combat_actions
        (encounter_id, character_id, node_id, ability_key, target_creature_id, client_seq, status, eligible_after_ms)
        values (${encounterId}, ${char}, ${nodeId}, 'power_strike', ${victim}, 1, 'pending', ${now - 1000})`;

      // An already-started cast, due, with the caster's target off-node.
      await sql`insert into public.encounter_cast_events
        (encounter_id, node_id, creature_id, cast_key, ability_key, started_at, expires_at, payload)
        values (${encounterId}, ${nodeId}, ${victim}, 'validation_nova', 'validation_nova',
                ${new Date(now - 8000).toISOString()}, ${new Date(now - 1000).toISOString()},
                ${sql.json({ config: { label: 'Validation Nova', baseDamage: 10, baseAoeDamage: 0, consumeMode: 'all', primaryShare: 1, aoeShare: 0, pauseAutoattacks: true, storedPowerCap: 0, lockMs: 0 } })})`;
      await sql`update public.characters set current_node_id = ${created.otherNodeId} where id = ${char}`;

      const durBefore = await sql<Row[]>`select current_durability from public.character_inventory where character_id = ${char}`;
      const t = await tick('catchup', char, []);
      const durAfter = await sql<Row[]>`select current_durability from public.character_inventory where character_id = ${char}`;
      const [action] = await sql<Row[]>`select status, consumed_tick, reject_reason from public.combat_actions where character_id = ${char}`;
      const [creature] = await sql<Row[]>`select hp, is_alive, rewards_awarded_at from public.creatures where id = ${victim}`;
      const [{ n: awards }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.encounter_kill_awards where creature_id = ${victim}`;

      const count = (types: string[]) => t.events.filter((e) => types.includes(e.type)).length;
      const counters = {
        player_autoattacks: count(['autoattack_hit', 'autoattack_crit', 'autoattack_miss']),
        creature_attacks: count(['creature_hit', 'creature_crit', 'creature_miss', 'dodge', 'block', 'holy_shield_return']),
        ability_events: count(['ability_hit', 'ability_crit', 'ability_miss']),
        new_casts: count(['boss_cast_start']),
        dot_ticks: count(['dot_tick']),
        cast_closures: count(['boss_cast_resolve', 'boss_cast_hit', 'boss_cast_evaded', 'boss_cast_fizzle']),
        kills: count(['creature_died', 'kill']),
      };
      push('effects_only_mode_confirmed', t.ok && t.mode === 'catchup', { mode: t.mode, tick: t.tick, ok: t.ok });
      push('effects_only_zero_player_autoattacks', counters.player_autoattacks === 0, counters);
      push('effects_only_zero_creature_attacks', counters.creature_attacks === 0, counters);
      push('effects_only_consumes_no_pending_action',
        action?.status === 'pending' && action?.consumed_tick === null && action?.reject_reason === null, action);
      push('effects_only_starts_no_new_boss_cast', counters.new_casts === 0, counters);
      push('effects_only_changes_no_durability',
        JSON.stringify(durBefore) === JSON.stringify(durAfter), { durBefore, durAfter });
      push('effects_only_advances_persisted_effects', counters.dot_ticks > 0, counters);
      push('effects_only_kills_through_dot_and_awards_once',
        Number(creature?.hp) <= 0 && creature?.is_alive === false && awards <= 1,
        { hp: creature?.hp, alive: creature?.is_alive, awards });
      push('effects_only_closes_a_due_cast', counters.cast_closures > 0,
        { closures: counters.cast_closures, events: t.events.map((e) => e.type) });

      // Non-vacuity control: the same fixture in live mode does attack.
      await sql`update public.characters set current_node_id = ${nodeId} where id = ${char}`;
      const live = await makeCreature({ name: 'Validation Sparring Dummy', hp: 9000 });
      await admin.rpc('encounter_intake', { _character_id: char, _creature_ids: [live] });
      const tLive = await tick('live', char, [live]);
      push('control_live_tick_actually_attacks',
        tLive.events.some((e) => ['autoattack_hit', 'autoattack_miss', 'autoattack_crit', 'ability_hit', 'ability_miss'].includes(e.type)),
        { events: tLive.events.map((e) => e.type).slice(0, 12) });
    }

    const [{ value: mode }] = await sql<{ value: string }[]>`
      select value from public.combat_config where key = 'combat_mode'`;

    return json({
      section,
      all_pass: cases.every((c) => c.pass),
      combat_mode: mode,
      cases,
    });
  } catch (e) {
    return json({ section, error: (e as Error).message, stack: (e as Error).stack, cases }, 500);
  } finally {
    try {
      await sql`update public.combat_config set value = 'off' where key = 'combat_soak'`;
      for (const c of created.charIds) {
        await sql`delete from public.combat_soak_access where character_id = ${c}`;
      }
      if (created.nodeId) {
        await sql`delete from public.active_effects where node_id = ${created.nodeId}`;
        await sql`delete from public.encounter_cast_events where node_id = ${created.nodeId}`;
        await sql`delete from public.combat_actions where node_id = ${created.nodeId}`;
        await sql`delete from public.encounter_tick_batches where encounter_id in
                  (select id from public.encounters where node_id = ${created.nodeId})`;
        await sql`delete from public.encounters where node_id = ${created.nodeId}`;
      }
      for (const c of created.creatureIds) await sql`delete from public.creatures where id = ${c}`;
      for (const c of created.charIds) await sql`select public.delete_character_cascade(${c})`;
      if (created.nodeId) await sql`delete from public.nodes where id = ${created.nodeId}`;
      if (created.otherNodeId) await sql`delete from public.nodes where id = ${created.otherNodeId}`;
    } catch (e) {
      console.error('[c5-final-validation] teardown', e);
    }
    await sql.end();
  }
});
