/**
 * c5-final-validation — TEMPORARY deployed evidence for the final pre-soak gate.
 *
 * Reachable only through a temporary service-role validation path: either a
 * service-role credential, or the one-shot token row
 * `public.app_secrets['c5_validation_token']` presented as `x-c5-token`. Both
 * the function and the token row are removed after the run.
 *
 * Combat stays in global maintenance. Every tick runs through the ordinary
 * `combat_soak_access` allowlist, scoped to throwaway characters on throwaway
 * nodes, and the allowlist is torn down in `finally`.
 *
 * Nothing here simulates anything by itself. Every tick is
 *   orchestrateCombatResolution
 *     -> encounter claim -> encounter_snapshot_v2 -> decodeEncounterSnapshot
 *     -> resolveTickPure -> commit_encounter_tick_v2
 * so an assertion about "the next snapshot" is an assertion about what the
 * deployed chain actually persisted and re-read.
 *
 * Sections (`?section=`), run separately to stay inside the request budget:
 *   stance       — reconstruction, lifetime, stacks, cancellation, replacement.
 *   death        — the full stance/death matrix and trigger-ordering proof.
 *   regen        — Force Shield pool authority and regeneration.
 *   power        — Stored Power bank -> assignment -> consume -> commit.
 *   effectsonly  — deployed effects-only counters.
 *   security     — deployed combat-catchup perimeter probes.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';
import { corsHeaders } from '../_shared/http.ts';
import { orchestrateCombatResolution } from '../_shared/combat/c3/orchestration.ts';
import { buildAbilityCatalog } from '../_shared/combat/c3-catalog.ts';

/** The stance no-expiry sentinel (Number.MAX_SAFE_INTEGER). */
const STANCE_NO_EXPIRY_MS = 9007199254740991;

interface CaseResult { case: string; pass: boolean; detail?: unknown }
type Row = Record<string, unknown>;

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
  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });

  // ── temporary service-role validation path ────────────────────────────────
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const headerToken = req.headers.get('x-c5-token')?.trim() ?? '';
  let authorized = bearer !== '' && bearer === srvKey;
  if (!authorized && headerToken) {
    const rows = await sql<Row[]>`select value from public.app_secrets where key = 'c5_validation_token'`;
    authorized = rows.length > 0 && String(rows[0].value) === headerToken;
  }
  if (!authorized) {
    await sql.end();
    return json({ error: 'forbidden: temporary service-role validation path only' }, 403);
  }

  // Fixtures belong to an Overlord account so the owner-scoped stance RPCs run
  // exactly as they do for a player.
  const [{ user_id: uid }] = await sql<{ user_id: string }[]>`
    select user_id from public.user_roles where role = 'overlord' limit 1`;

  /** Owner-scoped RPC, executed with the fixture owner's identity claims. */
  const userRpc = async (fn: string, args: Record<string, unknown>) => {
    const names = Object.keys(args);
    const values = names.map((n) => args[n]);
    const call = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
    try {
      const out = await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true)`;
        return await tx.unsafe(`select public.${fn}(${call}) as result`, values as never[]);
      });
      return { data: (out as unknown as Row[])?.[0]?.result ?? null, error: null as null | { message: string } };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  };

  const section = new URL(req.url).searchParams.get('section') ?? 'stance';
  const cases: CaseResult[] = [];
  const notes: Record<string, unknown> = {};
  const push = (name: string, pass: boolean, detail?: unknown) => cases.push({ case: name, pass, detail });

  const created: { nodeId?: string; otherNodeId?: string; charIds: string[]; creatureIds: string[]; userIds: string[] } = {
    charIds: [], creatureIds: [], userIds: [],
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

    const makeChar = async (classKey: string, over: Partial<Record<string, number>> = {}, owner = uid) => {
      const [{ id }] = await sql<{ id: string }[]>`
        insert into public.characters
          (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, ac, current_node_id,
           str, dex, con, "int", wis, cha)
        values (${owner}, ${'Val' + Math.floor(Math.random() * 1_000_000)}, 'human', ${classKey},
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
    const charState = async (charId: string) => {
      const [r] = await sql<Row[]>`
        select reserved_buffs, stance_state, cp, hp from public.characters where id = ${charId}`;
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

      const act = await userRpc('activate_stance', {
        p_character_id: wizard, p_stance_key: 'force_shield', p_tier: 1,
      });
      const actIgnite = await userRpc('activate_stance', {
        p_character_id: wizard, p_stance_key: 'ignite', p_tier: 3,
      });
      push('activation_reserves_cp_without_semantic_row',
        !act.error && !actIgnite.error && (await stanceRows(wizard)).length === 0,
        { reserved: (await charState(wizard)).reserved_buffs, error: act.error ?? actIgnite.error });

      const before = await charState(wizard);
      const t1 = await tick('live', wizard, [dummy]);
      const rows1 = await stanceRows(wizard);
      const after = await charState(wizard);

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

      for (let i = 0; i < 4; i++) await tick('live', wizard, [dummy]);
      const actEnv = await userRpc('activate_stance', {
        p_character_id: assassin, p_stance_key: 'envenom', p_tier: 3,
      });
      for (let i = 0; i < 4; i++) await tick('live', assassin, [dummy]);
      const creatureEffects = await effectsOf(dummy);
      // Landed stacks are ordinary finite DoT debuffs on the creature; their
      // identity is the applying ability, never a "_stack" effect-type suffix.
      const stacks = creatureEffects.filter((r) =>
        String(r.mechanic) === 'dot_debuff' &&
        ['ignite', 'envenom'].includes(String(r.source_ability_key)));
      push('ignite_and_envenom_apply_target_stacks',
        stacks.length > 0 && !actEnv.error,
        {
          stacks: stacks.map((r) => ({
            e: r.effect_type, ability: r.source_ability_key,
            src: r.source_id === assassin ? 'assassin' : 'wizard', stacks: r.stacks,
          })),
          all_creature_effects: creatureEffects.map((r) => ({
            e: r.effect_type, m: r.mechanic, ability: r.source_ability_key, lifetime: r.lifetime,
          })),
        });
      push('target_stacks_keep_a_finite_lifetime_of_their_own',
        stacks.length > 0 && stacks.every((r) => r.lifetime === 'timed' && Number(r.expires_at) < STANCE_NO_EXPIRY_MS),
        stacks.map((r) => ({ e: r.effect_type, lifetime: r.lifetime, expires_in_ms: Number(r.expires_at) - Date.now() })));

      const mutex = await userRpc('activate_stance', {
        p_character_id: assassin, p_stance_key: 'ignite', p_tier: 3,
      });
      push('mutually_exclusive_stance_is_refused', !!mutex.error, { error: mutex.error?.message });

      await userRpc('drop_stance', { p_character_id: assassin, p_stance_key: 'envenom' });
      const envAfterDrop = await stanceRows(assassin);
      const reAct = await userRpc('activate_stance', {
        p_character_id: assassin, p_stance_key: 'eagle_eye', p_tier: 1,
      });
      push('replacement_releases_the_previous_stance_only',
        envAfterDrop.length === 0 && !reAct.error &&
        !JSON.stringify((await charState(assassin)).reserved_buffs).includes('envenom'),
        { rows_after_drop: envAfterDrop.length, reserved: (await charState(assassin)).reserved_buffs });

      await tick('live', assassin, [dummy]);
      const invalid = (await stanceRows(assassin)).filter((r) => r.effect_type === 'eagle_eye');
      push('class_change_or_foreign_stance_cannot_materialise',
        invalid.length === 0, { rows: invalid.length });
      await userRpc('drop_stance', { p_character_id: assassin, p_stance_key: 'eagle_eye' });

      await userRpc('drop_stance', { p_character_id: wizard, p_stance_key: 'ignite' });
      const afterCancel = await stanceRows(wizard);
      push('cancellation_removes_reservation_and_semantic_effect',
        afterCancel.length === 1 && afterCancel[0].effect_type === 'force_shield' &&
        !JSON.stringify((await charState(wizard)).reserved_buffs).includes('ignite'),
        { rows: afterCancel.map((r) => r.effect_type), reserved: (await charState(wizard)).reserved_buffs });

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

      await sql`update public.active_effects set remaining = 0
                where target_id = ${wizard} and effect_type = 'force_shield'`;
      await tick('live', wizard, [dummy]);
      const depleted = await stanceRows(wizard);
      push('depleted_absorb_stance_stays_active_but_empty',
        depleted.length === 1 && Number(depleted[0].remaining) === 0,
        { remaining: depleted[0]?.remaining, magnitude: depleted[0]?.magnitude });

      const [{ n: orphans }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.active_effects ae
        where ae.lifetime = 'stance'
          and not exists (select 1 from public.characters c
                          where c.id = ae.target_id
                            and coalesce(c.reserved_buffs, '{}'::jsonb) ? ae.effect_type)`;
      push('no_orphaned_stance_effect_anywhere_in_the_database', orphans === 0, { orphans });
    }

    // ══════════════════════════════════════════════════════════════════════
    if (section === 'death') {
      const dummy = await makeCreature({ name: 'Validation Effigy' });
      const reaper = await makeCreature({ name: 'Validation Reaper', aggressive: true, hp: 30000, level: 30 });

      /** A fresh victim with live stances and a materialised semantic row. */
      const arm = async (
        classKey: string,
        stances: { key: string; tier: number }[],
        opts: { shieldPool?: number } = {},
      ) => {
        const c = await makeChar(classKey);
        await openSoak(c);
        await admin.rpc('encounter_ensure_for_character', { _character_id: c });
        await admin.rpc('encounter_intake', { _character_id: c, _creature_ids: [dummy] });
        for (const s of stances) {
          const r = await userRpc('activate_stance', {
            p_character_id: c, p_stance_key: s.key, p_tier: s.tier,
          });
          if (r.error) throw new Error(`activate ${s.key}: ${r.error.message}`);
        }
        await tick('live', c, [dummy]);
        if (opts.shieldPool !== undefined) {
          await sql`update public.active_effects set remaining = ${opts.shieldPool}
                    where target_id = ${c} and effect_type = 'force_shield'`;
        }
        const rows = await stanceRows(c);
        const st = await charState(c);
        return { id: c, rowsBefore: rows.length, reservedBefore: st.reserved_buffs, cpBefore: Number(st.cp) };
      };

      /** Final committed state after death, plus the orphan check. */
      const finalState = async (c: string) => {
        const st = await charState(c);
        const rows = await stanceRows(c);
        const ss = (st.stance_state ?? {}) as Record<string, unknown>;
        return {
          hp: Number(st.hp),
          reserved: st.reserved_buffs,
          reserved_empty: JSON.stringify(st.reserved_buffs ?? {}) === '{}',
          shield_keys_cleared: !('force_shield_hp' in ss) && !('force_shield_updated_at' in ss),
          stance_rows: rows.length,
          cp: Number(st.cp),
        };
      };

      const killByAttack = async (c: string) => {
        await sql`update public.characters set hp = 1, ac = 1 where id = ${c}`;
        await admin.rpc('encounter_intake', { _character_id: c, _creature_ids: [reaper] });
        for (let i = 0; i < 8; i++) {
          await tick('live', c, [reaper]);
          const [r] = await sql<Row[]>`select hp from public.characters where id = ${c}`;
          if (Number(r.hp) <= 0) return true;
        }
        return false;
      };

      const killByDot = async (c: string) => {
        await sql`update public.characters set hp = 3 where id = ${c}`;
        const now = Date.now();
        await sql`insert into public.active_effects
          (node_id, target_id, source_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at,
           tick_rate_ms, source_ability_key, mechanic, magnitude, params, params_version, lifetime)
          values (${nodeId}, ${c}, ${dummy}, 'poison', 3, 50, ${now - 1}, ${now + 120_000},
                  2000, 'envenom', 'dot_debuff', null, ${sql.json({ maxStacks: 5, damageType: 'poison' })}, 1, 'timed')`;
        for (let i = 0; i < 6; i++) {
          await tick('live', c, [dummy]);
          const [r] = await sql<Row[]>`select hp from public.characters where id = ${c}`;
          if (Number(r.hp) <= 0) return true;
        }
        return false;
      };

      const killByCast = async (c: string) => {
        const { data: encId } = await admin.rpc('encounter_for_node', { _node_id: nodeId });
        const encounterId = String(encId);
        const boss = await makeCreature({
          name: 'Validation Channeller', aggressive: true, level: 30,
          bossCast: {
            ability_key: 'validation_nova', cast_key: 'validation_nova', label: 'Validation Nova',
            cast_ticks: 2, cooldown_ticks: 99, damage: 10, damage_aoe: 4, damage_type: 'fire',
            channeling: true, pause_autoattacks: true, target_mode: 'random_alive',
            stored_power: { cap: 4000, primary_share: 1, aoe_share: 0.5, consume_mode: 'all' },
          },
        });
        await admin.rpc('encounter_intake', { _character_id: c, _creature_ids: [boss] });
        await sql`update public.characters set hp = 5 where id = ${c}`;
        await sql`update public.encounters set stored_power = 3000, stored_power_cap = 4000,
                    stored_power_source_id = ${boss} where id = ${encounterId}`;
        await sql`delete from public.encounter_cast_events where encounter_id = ${encounterId}`;
        await sql`insert into public.encounter_cast_events
          (encounter_id, node_id, creature_id, cast_key, ability_key, started_at, expires_at, payload)
          values (${encounterId}, ${nodeId}, ${boss}, 'validation_nova', 'validation_nova',
                  ${new Date(Date.now() - 8000).toISOString()}, ${new Date(Date.now() - 1000).toISOString()},
                  ${sql.json({
                    config: {
                      label: 'Validation Nova', targetCharacterId: c, baseDamage: 10, baseAoeDamage: 4,
                      damageType: 'fire', primaryShare: 1, aoeShare: 0.5, consumeMode: 'all',
                      consumePct: 100, consumeFixed: 0, pauseAutoattacks: true, storedPowerCap: 4000,
                      lockMs: 0, castedText: null,
                    },
                    stored_power: { cap: 4000 },
                  })})`;
        for (let i = 0; i < 5; i++) {
          await tick('live', c, [boss]);
          const [r] = await sql<Row[]>`select hp from public.characters where id = ${c}`;
          if (Number(r.hp) <= 0) return true;
        }
        return false;
      };

      // 1. Envenom (assassin) killed by a creature attack.
      const env = await arm('assassin', [{ key: 'envenom', tier: 3 }]);
      const envDied = await killByAttack(env.id);
      const envAfter = await finalState(env.id);
      push('envenom_death_by_creature_attack_clears_everything',
        envDied && envAfter.reserved_empty && envAfter.stance_rows === 0 && envAfter.shield_keys_cleared,
        { rows_before: env.rowsBefore, reserved_before: env.reservedBefore, ...envAfter });

      // 2. Ignite (wizard) killed by a damage-over-time effect.
      const ign = await arm('wizard', [{ key: 'ignite', tier: 3 }]);
      const ignDied = await killByDot(ign.id);
      const ignAfter = await finalState(ign.id);
      push('ignite_death_by_dot_clears_everything',
        ignDied && ignAfter.reserved_empty && ignAfter.stance_rows === 0,
        { rows_before: ign.rowsBefore, died: ignDied, ...ignAfter });

      // 3. Force Shield with a nonzero pool, killed by a boss cast + Stored Power.
      const fsFull = await arm('wizard', [{ key: 'force_shield', tier: 1 }], { shieldPool: 14 });
      const fsDied = await killByCast(fsFull.id);
      const fsAfter = await finalState(fsFull.id);
      push('force_shield_nonzero_pool_death_by_boss_cast_clears_everything',
        fsDied && fsAfter.reserved_empty && fsAfter.stance_rows === 0 && fsAfter.shield_keys_cleared,
        { died: fsDied, rows_before: fsFull.rowsBefore, ...fsAfter });

      // 4. Force Shield already depleted, killed by a creature attack.
      const fsEmpty = await arm('wizard', [{ key: 'force_shield', tier: 1 }], { shieldPool: 0 });
      const fsEmptyDied = await killByAttack(fsEmpty.id);
      const fsEmptyAfter = await finalState(fsEmpty.id);
      push('depleted_force_shield_death_clears_everything',
        fsEmptyDied && fsEmptyAfter.reserved_empty && fsEmptyAfter.stance_rows === 0 &&
        fsEmptyAfter.shield_keys_cleared,
        { died: fsEmptyDied, ...fsEmptyAfter });

      // 5. Several simultaneous stance rows on one character.
      const multi = await arm('wizard', [{ key: 'force_shield', tier: 1 }, { key: 'ignite', tier: 3 }]);
      const multiDied = await killByAttack(multi.id);
      const multiAfter = await finalState(multi.id);
      push('multiple_simultaneous_stances_all_end_on_death',
        multiDied && multi.rowsBefore === 2 && multiAfter.reserved_empty && multiAfter.stance_rows === 0,
        { rows_before: multi.rowsBefore, died: multiDied, ...multiAfter });

      // 6. Duplicate / reclaimed commit after death: nothing moves, nothing
      //    rematerialises, the reservation is released exactly once.
      const cpAfterDeath = multiAfter.cp;
      await tick('live', multi.id, [reaper]);
      await tick('live', multi.id, [dummy]);
      const dupAfter = await finalState(multi.id);
      push('reserved_cp_released_exactly_once_and_no_later_tick_rematerialises',
        dupAfter.reserved_empty && dupAfter.stance_rows === 0 && dupAfter.cp === cpAfterDeath,
        { cp_before_death: multi.cpBefore, cp_after_death: cpAfterDeath, cp_after_duplicates: dupAfter.cp });

      // 7. Already-dead character: ticks change nothing.
      const alreadyDead = await finalState(multi.id);
      await tick('live', multi.id, [reaper]);
      const stillDead = await finalState(multi.id);
      push('already_dead_character_is_inert',
        JSON.stringify(alreadyDead) === JSON.stringify(stillDead), { alreadyDead, stillDead });

      // 8. Damage that does not cross into death keeps the stance.
      const survivor = await arm('wizard', [{ key: 'force_shield', tier: 1 }, { key: 'ignite', tier: 3 }]);
      await sql`update public.characters set hp = 2000 where id = ${survivor.id}`;
      await tick('live', survivor.id, [dummy]);
      const survAfter = await finalState(survivor.id);
      push('non_lethal_damage_keeps_stance_reservation_and_rows',
        survAfter.hp > 0 && !survAfter.reserved_empty && survAfter.stance_rows === 2,
        survAfter);

      // 9. Reactivation after revival follows normal activation and CP rules.
      await sql`update public.characters set hp = 4000, cp = 400 where id = ${multi.id}`;
      const reAct = await userRpc('activate_stance', {
        p_character_id: multi.id, p_stance_key: 'force_shield', p_tier: 1,
      });
      const reserveEntry = ((reAct.data ?? {}) as Record<string, Record<string, unknown>>)['force_shield'];
      await tick('live', multi.id, [dummy]);
      const revived = await finalState(multi.id);
      push('reactivation_after_revival_follows_normal_rules',
        !reAct.error && Number(reserveEntry?.reserved) === Math.max(5, Math.ceil(400 * 0.10)) &&
        revived.stance_rows === 1,
        { reserve_entry: reserveEntry, expected_reserved: Math.max(5, Math.ceil(400 * 0.10)), ...revived });

      // 10. Trigger ordering: an effect upsert that lands AFTER the death write
      //     inside the same transaction must still lose. The stance-release
      //     trigger is deferred to commit; `sync_stance_effects` then removes
      //     the row regardless of insert order.
      const ordering = await arm('wizard', [{ key: 'force_shield', tier: 1 }]);
      let orderingErr: string | null = null;
      try {
        await sql.begin(async (tx) => {
          await tx`update public.characters set hp = 0 where id = ${ordering.id}`;
          await tx`update public.active_effects set remaining = 7
                   where target_id = ${ordering.id} and effect_type = 'force_shield'`;
        });
      } catch (e) { orderingErr = (e as Error).message; }
      const orderAfter = await finalState(ordering.id);
      push('deferred_trigger_wins_regardless_of_effect_upsert_ordering',
        !orderingErr && orderAfter.reserved_empty && orderAfter.stance_rows === 0 &&
        orderAfter.shield_keys_cleared,
        { error: orderingErr, ...orderAfter });

      // 11. Nothing orphaned anywhere.
      const [{ n: orphans }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.active_effects ae
        where ae.lifetime = 'stance'
          and not exists (select 1 from public.characters c
                          where c.id = ae.target_id
                            and coalesce(c.reserved_buffs, '{}'::jsonb) ? ae.effect_type)`;
      const [{ n: deadReserved }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.characters
        where hp <= 0 and coalesce(reserved_buffs, '{}'::jsonb) <> '{}'::jsonb`;
      push('no_orphaned_reservation_effect_or_cp_state_remains',
        orphans === 0 && deadReserved === 0, { orphans, dead_characters_with_reservations: deadReserved });
    }

    // ══════════════════════════════════════════════════════════════════════
    if (section === 'regen') {
      const wizard = await makeChar('wizard');
      await openSoak(wizard);
      const dummy = await makeCreature({ name: 'Validation Effigy' });
      await admin.rpc('encounter_ensure_for_character', { _character_id: wizard });
      await admin.rpc('encounter_intake', { _character_id: wizard, _creature_ids: [dummy] });
      await userRpc('activate_stance', { p_character_id: wizard, p_stance_key: 'force_shield', p_tier: 1 });
      await tick('live', wizard, [dummy]);

      // Fixture formula, inspectable: no equipped gear, so gear_int = gear_wis = 0.
      const INT = 18, WIS = 18, LEVEL = 20;
      const intMod = Math.max(0, Math.floor((INT - 10) / 2));      // 4
      const wisMod = Math.max(0, Math.floor((WIS - 10) / 2));      // 4
      const cap = Math.max(1, wisMod + Math.floor(LEVEL / 2));     // 14
      const regenPerTick = 1 + Math.floor(intMod / 2);             // 3
      const tickMs = 2000;
      notes.regen_formula = {
        int_total: INT, wis_total: WIS, level: LEVEL, int_mod: intMod, wis_mod: wisMod,
        cap: `max(1, wis_mod + floor(level/2)) = ${cap}`,
        regen_per_tick: `1 + floor(int_mod/2) = ${regenPerTick}`,
        tick_ms: tickMs,
      };

      const pool = async () => {
        const [r] = await sql<Row[]>`
          select remaining, magnitude from public.active_effects
          where target_id = ${wizard} and lifetime = 'stance' and effect_type = 'force_shield'`;
        return r ? { remaining: Number(r.remaining), magnitude: Number(r.magnitude) } : null;
      };
      const mirror = async () => {
        const [r] = await sql<Row[]>`select stance_state from public.characters where id = ${wizard}`;
        const ss = (r?.stance_state ?? {}) as Record<string, unknown>;
        return Number(ss.force_shield_hp ?? NaN);
      };
      const setPoolAndClock = async (remaining: number, elapsedMs: number) => {
        await sql`update public.active_effects set remaining = ${remaining}, magnitude = ${cap}
                  where target_id = ${wizard} and lifetime = 'stance' and effect_type = 'force_shield'`;
        await sql`update public.characters
                  set stance_state = coalesce(stance_state, '{}'::jsonb)
                      || jsonb_build_object('force_shield_hp', ${remaining},
                                            'force_shield_updated_at',
                                            to_jsonb(now() - make_interval(secs => ${elapsedMs / 1000})))
                  where id = ${wizard}`;
      };
      const clearSessions = () =>
        sql`delete from public.combat_sessions where node_id = ${nodeId}`;

      push('active_effects_remaining_is_the_authoritative_pool',
        (await pool()) !== null, { pool: await pool() });

      // In combat: no regeneration.
      await clearSessions();
      await sql`insert into public.combat_sessions (character_id, node_id, engaged_creature_ids, last_tick_at, tick_rate_ms)
                values (${wizard}, ${nodeId}, array[${dummy}]::uuid[], ${Date.now()}, 2000)`;
      await setPoolAndClock(4, 20_000);
      const inCombat = await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const inCombatPool = await pool();
      push('in_combat_ticks_do_not_regenerate_the_pool',
        !inCombat.error && inCombatPool?.remaining === 4,
        { remaining: inCombatPool?.remaining, expected: 4, mirror: await mirror() });
      await clearSessions();

      // Out of combat, partial pool: 4 + floor(20000/2000)*3 = 34 -> capped 14.
      await setPoolAndClock(4, 6_000);
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const partial = await pool();
      const expectPartial = Math.min(cap, 4 + Math.floor(6000 / tickMs) * regenPerTick); // 13
      push('out_of_combat_regenerates_by_the_int_derived_amount',
        partial?.remaining === expectPartial,
        { remaining: partial?.remaining, expected: expectPartial, formula: `min(${cap}, 4 + 3*${regenPerTick})` });

      // Zero pool replenishes while the stance stays active.
      await setPoolAndClock(0, 4_000);
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const zero = await pool();
      const expectZero = Math.min(cap, 0 + 2 * regenPerTick); // 6
      push('a_zero_pool_replenishes_while_the_stance_remains_active',
        zero?.remaining === expectZero && (await stanceRows(wizard)).length === 1,
        { remaining: zero?.remaining, expected: expectZero });

      // Cap enforcement.
      await setPoolAndClock(13, 60_000);
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const capped = await pool();
      push('the_wis_level_cap_is_enforced', capped?.remaining === cap,
        { remaining: capped?.remaining, cap });

      // A full pool does not exceed the cap.
      await setPoolAndClock(cap, 60_000);
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const full = await pool();
      push('a_full_pool_never_exceeds_the_cap', full?.remaining === cap,
        { remaining: full?.remaining, cap });

      // Mirror equals the committed authoritative pool.
      push('stance_state_is_only_a_mirror_of_the_authoritative_pool',
        (await mirror()) === (await pool())?.remaining,
        { mirror: await mirror(), authoritative: (await pool())?.remaining });

      // Duplicate regeneration cannot apply twice: the clock has been consumed.
      await setPoolAndClock(4, 4_000);
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const once = (await pool())?.remaining;
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const twice = (await pool())?.remaining;
      push('duplicate_regeneration_cannot_apply_twice', once === twice,
        { after_first: once, after_second: twice });

      // A live tick under a claim does not regenerate the pool either.
      await setPoolAndClock(2, 30_000);
      await tick('live', wizard, [dummy]);
      const afterTick = await pool();
      push('an_authoritative_tick_applies_no_regeneration',
        (afterTick?.remaining ?? -1) <= 2, { remaining: afterTick?.remaining });

      // Death removes the stance rather than regenerating it.
      await setPoolAndClock(0, 60_000);
      await sql`update public.characters set hp = 0 where id = ${wizard}`;
      const deadRegen = await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const deadPool = await pool();
      const deadState = await charState(wizard);
      push('death_removes_the_stance_instead_of_regenerating_it',
        deadPool === null && JSON.stringify(deadState.reserved_buffs ?? {}) === '{}' &&
        !('force_shield_hp' in ((deadState.stance_state ?? {}) as Record<string, unknown>)),
        { pool: deadPool, reserved: deadState.reserved_buffs, stance_state: deadState.stance_state, regen: deadRegen.data });
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
        primaryShare?: number; aoeShare?: number; target: string | null; cap?: number; creature?: string;
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
          values (${encounterId}, ${nodeId}, ${o.creature ?? boss}, 'validation_nova', 'validation_nova',
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
        await sql`update public.characters set hp = 4000 where id in (${primary}, ${secondary})`;
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
            tick_ok: t.ok, tick_mode: t.mode, event_types: t.events.map((e) => e.type),
            tick_raw: t.ok ? undefined : t.raw,
          });
        push(`stored_power_${m.name}_primary_and_aoe_shares`,
          Number(prim?.payload?.amount ?? -1) === expectPrimary &&
          (aoe === undefined || Number(aoe.payload?.amount) === expectAoe),
          { primary: prim?.payload?.amount, aoe: aoe?.payload?.amount, expectPrimary, expectAoe });

        // Inertness is about the SAME cast never resolving twice. A later tick
        // legitimately starts a new telegraph and may bank fresh power, so the
        // pool value is not the invariant — the resolution count is.
        const t2 = await tick('live', primary, [boss]);
        const rehits = t2.events.filter((e) => e.type === 'boss_cast_hit'
          && (e.payload?.creatureId === boss)
          && Number(e.payload?.amount ?? 0) >= expectPrimary);
        push(`stored_power_${m.name}_duplicate_resolution_is_inert`,
          rehits.length === 0,
          { pool_after_second_tick: await poolNow(), rehits: rehits.length,
            event_types: t2.events.map((e) => e.type) });
      }

      // Cap: banking during a channel may never exceed the configured cap.
      await setPool(390, 400);
      await seedCast({ consumeMode: 'all', dueMs: 30_000, target: primary, cap: 400 });
      await tick('live', primary, [boss]);
      const capped = await poolNow();
      push('stored_power_banking_respects_the_cap', capped <= 400, { pool: capped });

      // Delayed resolution: a long-overdue cast still resolves exactly once.
      await sql`update public.characters set hp = 4000 where id in (${primary}, ${secondary})`;
      await setPool(100, 400);
      await seedCast({ consumeMode: 'all', dueMs: -120_000, target: primary, cap: 400 });
      const tDelayed = await tick('live', primary, [boss]);
      const delayedHits = tDelayed.events.filter((e) => e.type === 'boss_cast_hit').length;
      const delayedPool = await poolNow();
      const tDelayed2 = await tick('live', primary, [boss]);
      push('delayed_resolution_lands_once_and_consumes_once',
        delayedHits > 0 && delayedPool === 0 &&
        tDelayed2.events.filter((e) => e.type === 'boss_cast_hit').length === 0 &&
        (await poolNow()) === 0,
        { hits: delayedHits, pool: delayedPool });

      // Flee / no eligible target: the pool still drains, nobody is hit.
      await setPool(100, 400);
      await seedCast({ consumeMode: 'all', dueMs: -1000, target: primary, cap: 400 });
      await sql`update public.characters set current_node_id = ${created.otherNodeId} where id in (${primary}, ${secondary})`;
      const tFlee = await tick('live', primary, [boss]);
      const fleeHits = tFlee.events.filter((e) => e.type === 'boss_cast_hit').length;
      const fleePool = await poolNow();
      push('stored_power_no_target_drains_without_damage',
        fleeHits === 0 && fleePool === 0,
        { hits: fleeHits, pool: fleePool, events: tFlee.events.map((e) => e.type) });
      await sql`update public.characters set current_node_id = ${nodeId} where id in (${primary}, ${secondary})`;

      // Fizzle: the caster dies before the cast is due.
      await sql`update public.characters set hp = 4000 where id in (${primary}, ${secondary})`;
      await setPool(100, 400);
      await seedCast({ consumeMode: 'all', dueMs: -1000, target: primary, cap: 400 });
      await sql`update public.creatures set hp = 0, is_alive = false where id = ${boss}`;
      const tFizzle = await tick('live', primary, [boss]);
      const fizzlePool = await poolNow();
      const [{ n: openCasts }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.encounter_cast_events
        where encounter_id = ${encounterId} and resolved_at is null`;
      push('boss_death_before_resolution_fizzles_without_damage',
        tFizzle.events.filter((e) => e.type === 'boss_cast_hit').length === 0 && fizzlePool === 0,
        { pool: fizzlePool, open_casts: openCasts, events: tFizzle.events.map((e) => e.type) });

      // The next snapshot carries the committed balance.
      const { data: snap } = await admin.rpc('encounter_resync_snapshot', { _encounter_id: encounterId });
      notes.next_snapshot_stored_power = (snap as Record<string, unknown> | null)?.storedPower ??
        (snap as Record<string, unknown> | null)?.stored_power ?? null;
      push('next_snapshot_reports_the_committed_balance',
        Number(notes.next_snapshot_stored_power ?? fizzlePool) === fizzlePool,
        { snapshot_balance: notes.next_snapshot_stored_power, committed: fizzlePool });
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

      const [item] = await sql<Row[]>`select id from public.items limit 1`;
      if (item) {
        await sql`insert into public.character_inventory
                  (character_id, item_id, equipped_slot, current_durability)
                  values (${char}, ${item.id}, 'main_hand', 100)`;
      }

      const now = Date.now();
      await sql`insert into public.active_effects
        (node_id, target_id, source_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at,
         tick_rate_ms, source_ability_key, mechanic, magnitude, params, params_version)
        values (${nodeId}, ${victim}, ${char}, 'poison', 2, 5, ${now - 1}, ${now + 120_000},
                2000, 'envenom', 'dot_debuff', null, ${sql.json({ maxStacks: 5, damageType: 'poison' })}, 1)`;

      // An effect that must expire during the sweep.
      await sql`insert into public.active_effects
        (node_id, target_id, source_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at,
         tick_rate_ms, source_ability_key, mechanic, magnitude, params, params_version)
        values (${nodeId}, ${victim}, ${char}, 'bleed', 1, 1, ${now - 1}, ${now - 1},
                2000, 'rend', 'dot_debuff', null, ${sql.json({ maxStacks: 5, damageType: 'physical' })}, 1)`;

      await sql`insert into public.combat_actions
        (encounter_id, character_id, node_id, ability_key, target_creature_id, client_seq, status, eligible_after_ms)
        values (${encounterId}, ${char}, ${nodeId}, 'power_strike', ${victim}, 1, 'pending', ${now - 1000})`;

      await sql`insert into public.encounter_cast_events
        (encounter_id, node_id, creature_id, cast_key, ability_key, started_at, expires_at, payload)
        values (${encounterId}, ${nodeId}, ${victim}, 'validation_nova', 'validation_nova',
                ${new Date(now - 8000).toISOString()}, ${new Date(now - 1000).toISOString()},
                ${sql.json({ config: { label: 'Validation Nova', baseDamage: 10, baseAoeDamage: 0, consumeMode: 'all', primaryShare: 1, aoeShare: 0, pauseAutoattacks: true, storedPowerCap: 0, lockMs: 0 } })})`;
      await sql`update public.characters set current_node_id = ${created.otherNodeId} where id = ${char}`;

      const durBefore = await sql<Row[]>`select current_durability from public.character_inventory where character_id = ${char}`;
      const effectsBefore = (await effectsOf(victim)).length;
      const t = await tick('catchup', char, []);
      const durAfter = await sql<Row[]>`select current_durability from public.character_inventory where character_id = ${char}`;
      const [action] = await sql<Row[]>`select status, consumed_tick, reject_reason from public.combat_actions where character_id = ${char}`;
      const [creature] = await sql<Row[]>`select hp, is_alive from public.creatures where id = ${victim}`;
      const [{ n: awards }] = await sql<{ n: number }[]>`
        select count(*)::int as n from public.encounter_kill_awards where creature_id = ${victim}`;
      const effectsAfter = (await effectsOf(victim)).length;

      const count = (types: string[]) => t.events.filter((e) => types.includes(e.type)).length;
      const counters = {
        periodic_effects_processed: count(['dot_tick', 'hot_tick', 'effect_tick']),
        effect_expiries: count(['effect_expired', 'effect_expiry', 'debuff_expired']),
        offscreen_creature_deaths: count(['creature_died', 'kill']),
        exactly_once_rewards: awards,
        player_attacks: count(['autoattack_hit', 'autoattack_crit', 'autoattack_miss', 'ability_hit', 'ability_crit', 'ability_miss']),
        creature_attacks: count(['creature_hit', 'creature_crit', 'creature_miss', 'dodge', 'block', 'holy_shield_return']),
        pending_player_actions_consumed: action?.consumed_tick === null ? 0 : 1,
        new_boss_casts: count(['boss_cast_start']),
        live_only_procs: count(['proc', 'proc_hit', 'weapon_proc', 'lifesteal', 'heal_pulse']),
        durability_changes: JSON.stringify(durBefore) === JSON.stringify(durAfter) ? 0 : 1,
        cast_closures: count(['boss_cast_resolve', 'boss_cast_hit', 'boss_cast_evaded', 'boss_cast_fizzle']),
        effect_rows_before: effectsBefore,
        effect_rows_after: effectsAfter,
      };
      notes.effects_only_counters = counters;

      push('effects_only_mode_confirmed', t.ok && t.mode === 'catchup', { mode: t.mode, tick: t.tick, ok: t.ok });
      push('effects_only_zero_player_attacks', counters.player_attacks === 0, counters);
      push('effects_only_zero_creature_attacks', counters.creature_attacks === 0, counters);
      push('effects_only_consumes_no_pending_action',
        action?.status === 'pending' && action?.consumed_tick === null && action?.reject_reason === null, action);
      push('effects_only_starts_no_new_boss_cast', counters.new_boss_casts === 0, counters);
      push('effects_only_no_live_only_procs', counters.live_only_procs === 0, counters);
      push('effects_only_changes_no_durability', counters.durability_changes === 0, { durBefore, durAfter });
      push('effects_only_advances_persisted_effects', counters.periodic_effects_processed > 0, counters);
      push('effects_only_expires_due_effects', effectsAfter < effectsBefore,
        { before: effectsBefore, after: effectsAfter });
      push('effects_only_kills_through_dot_and_awards_once',
        Number(creature?.hp) <= 0 && creature?.is_alive === false && awards <= 1,
        { hp: creature?.hp, alive: creature?.is_alive, awards });
      push('effects_only_closes_a_due_cast_with_no_present_target',
        counters.cast_closures > 0 && counters.player_attacks === 0,
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

    // ══════════════════════════════════════════════════════════════════════
    if (section === 'security') {
      const endpoint = `${url}/functions/v1/combat-catchup`;
      const probe = async (
        name: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
      ) => {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(body),
        });
        let parsed: unknown = null;
        const text = await res.text();
        try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
        return { name, status: res.status, body: parsed };
      };

      // An ordinary player account with its own character on the fixture node.
      const email = `c5-validation-${crypto.randomUUID()}@example.invalid`;
      const password = crypto.randomUUID();
      const { data: newUser } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      const playerUid = newUser?.user?.id;
      if (playerUid) created.userIds.push(playerUid);
      const playerChar = playerUid ? await makeChar('warrior', {}, playerUid) : null;
      if (playerChar) await openSoak(playerChar);
      const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
      const { data: signIn } = await anonClient.auth.signInWithPassword({ email, password });
      const playerJwt = signIn?.session?.access_token ?? '';

      const ownChar = await makeChar('warrior');
      await openSoak(ownChar);

      const results = [
        await probe('anonymous_no_credential', {}, { character_id: playerChar }),
        await probe('anon_apikey_only', { apikey: anonKey }, { character_id: playerChar }),
        await probe('ordinary_authenticated_player',
          { Authorization: `Bearer ${playerJwt}`, apikey: anonKey }, { character_id: playerChar }),
        await probe('forged_role_and_mode_in_body',
          { Authorization: `Bearer ${playerJwt}`, apikey: anonKey },
          { character_id: playerChar, role: 'live', mode: 'live', supported_modes: ['live'] }),
        await probe('internal_service_role_forged_role_and_mode',
          { Authorization: `Bearer ${srvKey}`, apikey: srvKey },
          { character_id: ownChar, role: 'live', mode: 'live', supported_modes: ['live'] }),
        await probe('internal_service_role_valid_scope',
          { Authorization: `Bearer ${srvKey}`, apikey: srvKey }, { character_id: ownChar }),
        await probe('internal_service_role_out_of_scope_node',
          { Authorization: `Bearer ${srvKey}`, apikey: srvKey },
          { character_id: ownChar, node_id: created.otherNodeId }),
        await probe('internal_service_role_unknown_character',
          { Authorization: `Bearer ${srvKey}`, apikey: srvKey },
          { character_id: crypto.randomUUID() }),
        await probe('internal_service_role_duplicate_invocation',
          { Authorization: `Bearer ${srvKey}`, apikey: srvKey }, { character_id: ownChar }),
      ];
      notes.catchup_probes = results;
      const byName = Object.fromEntries(results.map((r) => [r.name, r]));

      push('anonymous_request_is_rejected', byName.anonymous_no_credential.status === 401,
        byName.anonymous_no_credential);
      push('anon_apikey_alone_is_rejected', byName.anon_apikey_only.status === 401,
        byName.anon_apikey_only);
      push('ordinary_authenticated_player_is_rejected',
        byName.ordinary_authenticated_player.status === 403, byName.ordinary_authenticated_player);
      push('forged_role_or_mode_from_a_player_is_rejected',
        byName.forged_role_and_mode_in_body.status === 403, byName.forged_role_and_mode_in_body);
      push('forged_role_or_mode_is_ignored_for_internal_callers',
        (byName.internal_service_role_forged_role_and_mode.body as Record<string, unknown>)?.mode !== 'live',
        byName.internal_service_role_forged_role_and_mode);
      push('valid_internal_caller_is_accepted',
        byName.internal_service_role_valid_scope.status === 200, byName.internal_service_role_valid_scope);
      push('out_of_scope_node_is_rejected',
        byName.internal_service_role_out_of_scope_node.status === 403,
        byName.internal_service_role_out_of_scope_node);
      push('unknown_character_is_rejected',
        byName.internal_service_role_unknown_character.status === 400,
        byName.internal_service_role_unknown_character);
      push('duplicate_internal_invocation_does_not_double_resolve',
        byName.internal_service_role_duplicate_invocation.status === 200 &&
        ((byName.internal_service_role_duplicate_invocation.body as Record<string, unknown>)?.ok !== true ||
         (byName.internal_service_role_valid_scope.body as Record<string, unknown>)?.ok !== true),
        {
          first: byName.internal_service_role_valid_scope.body,
          second: byName.internal_service_role_duplicate_invocation.body,
        });
    }

    const [{ value: mode }] = await sql<{ value: string }[]>`
      select value from public.combat_config where key = 'combat_mode'`;

    return json({
      section,
      all_pass: cases.every((c) => c.pass),
      combat_mode: mode,
      notes,
      cases,
    });
  } catch (e) {
    return json({ section, error: (e as Error).message, stack: (e as Error).stack, notes, cases }, 500);
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
        await sql`delete from public.combat_sessions where node_id = ${created.nodeId}`;
        await sql`delete from public.encounter_tick_batches where encounter_id in
                  (select id from public.encounters where node_id = ${created.nodeId})`;
        await sql`delete from public.encounters where node_id = ${created.nodeId}`;
      }
      for (const c of created.creatureIds) await sql`delete from public.creatures where id = ${c}`;
      for (const c of created.charIds) await sql`select public.delete_character_cascade(${c})`;
      if (created.nodeId) await sql`delete from public.nodes where id = ${created.nodeId}`;
      if (created.otherNodeId) await sql`delete from public.nodes where id = ${created.otherNodeId}`;
      for (const u of created.userIds) {
        try { await admin.auth.admin.deleteUser(u); } catch { /* reported by the leakage check */ }
      }
    } catch (e) {
      console.error('[c5-final-validation] teardown', e);
    }
    await sql.end();
  }
});
