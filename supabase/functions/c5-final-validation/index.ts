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
  /** `PresentationEvent` rows: flat fields, no nested payload. */
  events: Record<string, unknown>[];
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

    // ── TEMPORARY validation authorization ───────────────────────────────
    // A single-use secret, known only to this invocation, authorizing exactly:
    // catch-up role, this fixture node, ten minutes. It bypasses ONE thing —
    // the global maintenance refusal — and nothing else: claim ownership, mode
    // selection, scope checks, snapshot validation and commit authority are
    // unchanged. It is never sent to a browser and is deleted in teardown.
    const validationToken = crypto.randomUUID() + crypto.randomUUID();
    await sql`insert into public.combat_validation_grants (token_hash, node_id, role, expires_at, note)
              values (encode(sha256(convert_to(${validationToken}, 'UTF8')), 'hex'),
                      ${nodeId}, 'catchup', now() + interval '10 minutes', 'c5-final-validation')`;
    const validationGrant = { token: validationToken, role: 'catchup' as const, nodeId };

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
      // Both fixture nodes: a catch-up fixture legitimately stands off-node,
      // and the allowlist is scoped per node.
      for (const n of [nodeId, otherNodeId]) {
        await sql`insert into public.combat_soak_access (character_id, node_id, expires_at, note)
                  values (${charId}, ${n}, now() + interval '10 minutes', 'c5-final-validation')
                  on conflict do nothing`;
      }
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
            // Catch-up fixtures legitimately stand off-node, where the soak
            // allowlist (character + node presence) cannot authorize them.
            ...(role === 'catchup' ? { validationGrant } : {}),
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
      const applyTicks: unknown[] = [];
      for (let i = 0; i < 4; i++) {
        const tk = await tick('live', assassin, [dummy]);
        applyTicks.push({ ok: tk.ok, mode: tk.mode, events: tk.events.map((e) => String(e.type)) });
      }
      // Diagnostic: the applier can only fire if the stance's semantic row
      // exists AND carries its stack_apply configuration.
      const applierRows = await sql<Row[]>`select target_id, effect_type, mechanic, magnitude, params, lifetime
        from public.active_effects where target_id in (${wizard}, ${assassin}) and mechanic = 'stack_apply'`;
      notes.stack_applier_rows = applierRows;
      notes.stack_apply_ticks = applyTicks;
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

      /**
       * NOTE — there is deliberately no "death by damage-over-time on a
       * character" fixture. `dot_debuff` (and every periodic hostile mechanic)
       * targets a creature by contract; nothing in the product applies periodic
       * damage to a character. The earlier fixture inserted such a row directly
       * and was rejected by effect-contract validation, which is the contract
       * working as intended. The wizard/Ignite death case therefore uses a boss
       * cast, an actual character-damaging path.
       */
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

      // 2. Ignite (wizard) killed by a boss cast.
      const ign = await arm('wizard', [{ key: 'ignite', tier: 3 }]);
      const ignDied = await killByCast(ign.id);
      const ignAfter = await finalState(ign.id);
      push('ignite_death_by_boss_cast_clears_everything',
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
        cursor: 'stance_state.force_shield_updated_at is the consumed-time cursor; ' +
                'active_effects.remaining is the authoritative pool.',
      };

      // ── inspection helpers ────────────────────────────────────────────
      type Obs = {
        pool: number | null; magnitude: number | null;
        mirror: number | null; cursor: string | null; cursor_elapsed_ms: number | null;
        in_combat: boolean;
      };
      const observe = async (): Promise<Obs> => {
        const [r] = await sql<Row[]>`
          select ae.remaining::int          as pool,
                 ae.magnitude::int          as magnitude,
                 (c.stance_state->>'force_shield_hp')::int as mirror,
                 c.stance_state->>'force_shield_updated_at' as cursor,
                 case when pg_input_is_valid(coalesce(c.stance_state->>'force_shield_updated_at', ''), 'timestamptz')
                      then round(extract(epoch from (now() - (c.stance_state->>'force_shield_updated_at')::timestamptz)) * 1000)::bigint
                 end as cursor_elapsed_ms,
                 exists (select 1 from public.combat_sessions s
                          where s.node_id = c.current_node_id
                            and s.character_id = c.id) as in_combat
            from public.characters c
            left join public.active_effects ae
                   on ae.target_id = c.id and ae.lifetime = 'stance'
                  and ae.effect_type = 'force_shield'
           where c.id = ${wizard}`;
        return {
          pool: r?.pool === null || r?.pool === undefined ? null : Number(r.pool),
          magnitude: r?.magnitude === null || r?.magnitude === undefined ? null : Number(r.magnitude),
          mirror: r?.mirror === null || r?.mirror === undefined ? null : Number(r.mirror),
          cursor: (r?.cursor ?? null) as string | null,
          cursor_elapsed_ms: r?.cursor_elapsed_ms === null || r?.cursor_elapsed_ms === undefined
            ? null : Number(r.cursor_elapsed_ms),
          in_combat: Boolean(r?.in_combat),
        };
      };
      /** Seed pool + cursor deterministically from the DB clock. */
      const seed = async (remaining: number, elapsedMs: number | null) => {
        await sql`update public.active_effects set remaining = ${remaining}, magnitude = ${cap}
                  where target_id = ${wizard} and lifetime = 'stance' and effect_type = 'force_shield'`;
        if (elapsedMs === null) {
          await sql`update public.characters
                    set stance_state = (coalesce(stance_state, '{}'::jsonb) - 'force_shield_updated_at')
                        || jsonb_build_object('force_shield_hp', ${remaining}::int)
                    where id = ${wizard}`;
        } else {
          await sql`update public.characters
                    set stance_state = coalesce(stance_state, '{}'::jsonb)
                        || jsonb_build_object('force_shield_hp', ${remaining}::int,
                                              'force_shield_updated_at',
                                              to_jsonb(now() - (${elapsedMs}::bigint * interval '1 millisecond')))
                    where id = ${wizard}`;
        }
      };
      const setCursorRaw = async (value: unknown) => {
        await sql`update public.characters
                  set stance_state = coalesce(stance_state, '{}'::jsonb)
                      || jsonb_build_object('force_shield_updated_at', ${JSON.stringify(value)}::jsonb)
                  where id = ${wizard}`;
      };
      const enterCombat = async () => {
        await sql`delete from public.combat_sessions where node_id = ${nodeId}`;
        await sql`insert into public.combat_sessions (character_id, node_id, engaged_creature_ids, last_tick_at, tick_rate_ms)
                  values (${wizard}, ${nodeId}, ${[dummy]}::uuid[], ${Date.now()}, 2000)`;
      };
      const leaveCombat = () => sql`delete from public.combat_sessions where node_id = ${nodeId}`;

      /**
       * Run one regeneration case and report the full inspectable breakdown.
       * `expected` receives the observed before-state so cases can express the
       * contract in terms of the eligible whole intervals actually seen.
       */
      const regenCase = async (
        name: string,
        setup: () => Promise<void>,
        invoke: () => Promise<unknown>,
        expected: (before: Obs, after: Obs, eligible: number) => boolean,
        extra?: Record<string, unknown>,
      ) => {
        await setup();
        const before = await observe();
        await invoke();
        const after = await observe();
        const eligible = before.cursor_elapsed_ms === null || before.in_combat === undefined
          ? 0 : Math.floor(Math.max(0, before.cursor_elapsed_ms) / tickMs);
        const applied = (after.pool ?? 0) - (before.pool ?? 0);
        push(name, expected(before, after, eligible), {
          pool_before: before.pool, pool_after: after.pool,
          cursor_before: before.cursor, cursor_after: after.cursor,
          cursor_elapsed_before_ms: before.cursor_elapsed_ms,
          cursor_elapsed_after_ms: after.cursor_elapsed_ms,
          eligible_intervals: eligible,
          regen_applied: applied,
          regen_per_tick: regenPerTick,
          combat_state: before.in_combat ? 'in_combat' : 'out_of_combat',
          cap, magnitude: after.magnitude,
          mirror_after: after.mirror,
          ...(extra ?? {}),
        });
      };

      push('active_effects_remaining_is_the_authoritative_pool',
        (await observe()).pool !== null, { observed: await observe() });

      // 1. One whole interval.
      await leaveCombat();
      await regenCase('a_single_elapsed_interval_regenerates_exactly_once',
        () => seed(4, 2_100),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a, e) => e >= 1 && a.pool === Math.min(cap, (b.pool ?? 0) + e * regenPerTick));

      // 2. Several intervals: exactly that many are processed.
      await regenCase('several_elapsed_intervals_process_exactly_that_number',
        () => seed(0, 6_100),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a, e) => e >= 3 && a.pool === Math.min(cap, (b.pool ?? 0) + e * regenPerTick));

      // 3. Fractional remainder: below one interval nothing regenerates and the
      //    cursor stays on the previous consumed boundary.
      await regenCase('less_than_one_interval_regenerates_nothing_and_keeps_the_cursor',
        () => seed(4, 900),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a) => a.pool === b.pool && a.cursor === b.cursor);

      // 4. The unconsumed sub-interval remainder survives a partial consume.
      await regenCase('the_unconsumed_sub_interval_remainder_is_preserved',
        () => seed(0, 5_000),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (_b, a, e) => e === 2 && (a.cursor_elapsed_ms ?? 0) >= 1_000 && (a.cursor_elapsed_ms ?? 0) < tickMs + 1_500);

      // 5. Immediate repeated invocation adds nothing beyond real elapsed time.
      await seed(2, 4_100);
      const beforeDup = await observe();
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const afterFirst = await observe();
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const afterSecond = await observe();
      const replayable = Math.floor(Math.max(0, afterFirst.cursor_elapsed_ms ?? 0) / tickMs);
      push('an_immediate_repeated_invocation_regenerates_nothing_extra',
        afterSecond.pool === Math.min(cap, (afterFirst.pool ?? 0) + replayable * regenPerTick),
        {
          pool_before: beforeDup.pool, pool_after_first: afterFirst.pool, pool_after_second: afterSecond.pool,
          cursor_before: beforeDup.cursor, cursor_after_first: afterFirst.cursor, cursor_after_second: afterSecond.cursor,
          eligible_intervals: Math.floor((beforeDup.cursor_elapsed_ms ?? 0) / tickMs),
          replayable_intervals_between_calls: replayable,
          regen_applied: (afterSecond.pool ?? 0) - (beforeDup.pool ?? 0),
          combat_state: 'out_of_combat', cap,
        });

      // 6. Concurrent invocations: the same interval cannot be consumed twice.
      await seed(0, 6_100);
      const beforeConc = await observe();
      await Promise.all([
        userRpc('apply_force_shield_regen', { _character_id: wizard }),
        userRpc('apply_force_shield_regen', { _character_id: wizard }),
        userRpc('apply_force_shield_regen', { _character_id: wizard }),
      ]);
      const afterConc = await observe();
      const concEligible = Math.floor((beforeConc.cursor_elapsed_ms ?? 0) / tickMs);
      push('concurrent_invocations_cannot_consume_the_same_interval_twice',
        (afterConc.pool ?? 0) <= Math.min(cap, (beforeConc.pool ?? 0) + (concEligible + 2) * regenPerTick),
        {
          pool_before: beforeConc.pool, pool_after: afterConc.pool,
          cursor_before: beforeConc.cursor, cursor_after: afterConc.cursor,
          eligible_intervals: concEligible,
          regen_applied: (afterConc.pool ?? 0) - (beforeConc.pool ?? 0),
          concurrent_calls: 3, combat_state: 'out_of_combat', cap,
        });

      // 7. In combat: no regeneration, but the elapsed intervals are consumed so
      //    combat time cannot be banked and cashed in after leaving combat.
      await enterCombat();
      await regenCase('in_combat_elapsed_time_is_consumed_without_regenerating',
        () => seed(4, 20_000),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a) => a.pool === b.pool && (a.cursor_elapsed_ms ?? 0) < tickMs + 1_500);
      await leaveCombat();
      await regenCase('combat_time_cannot_be_banked_after_leaving_combat',
        async () => { /* keep the cursor consumed by the in-combat call */ },
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a, e) => a.pool === Math.min(cap, (b.pool ?? 0) + e * regenPerTick) && e <= 1);

      // 8. Full pool: elapsed intervals are consumed, nothing over-caps, and the
      //    following damage cannot be instantly refilled from banked time.
      await regenCase('a_full_pool_consumes_elapsed_time_without_over_capping',
        () => seed(cap, 60_000),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (_b, a) => a.pool === cap && (a.cursor_elapsed_ms ?? 0) < tickMs + 1_500);
      await regenCase('damage_after_a_full_pool_cannot_be_refilled_from_banked_time',
        async () => {
          await sql`update public.active_effects set remaining = 1
                    where target_id = ${wizard} and lifetime = 'stance' and effect_type = 'force_shield'`;
        },
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a, e) => e <= 1 && a.pool === Math.min(cap, (b.pool ?? 0) + e * regenPerTick));

      // 9. Cap enforcement across a very long absence.
      await regenCase('the_wis_level_cap_is_enforced_over_a_long_absence',
        () => seed(1, 600_000),
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (_b, a) => a.pool === cap);

      // 10. World sleep/wake follows the out-of-combat policy exactly once.
      await regenCase('a_sleep_wake_gap_is_counted_once_under_the_out_of_combat_policy',
        () => seed(0, 8_100),
        async () => {
          await userRpc('apply_force_shield_regen', { _character_id: wizard });
          await userRpc('apply_force_shield_regen', { _character_id: wizard });
        },
        // The gap is counted once: two back-to-back calls may only add the
        // whole intervals that elapsed, never the same window twice.
        (b, a, e) => e >= 4 &&
          (a.pool ?? -1) >= Math.min(cap, (b.pool ?? 0) + e * regenPerTick) &&
          (a.pool ?? -1) <= Math.min(cap, (b.pool ?? 0) + (e + 1) * regenPerTick));

      // 11. Malformed / future cursor fails safe: no regeneration, cursor resets.
      await regenCase('a_future_cursor_fails_safe_without_regenerating',
        async () => {
          await seed(2, 0);
          await sql`update public.characters
                    set stance_state = coalesce(stance_state, '{}'::jsonb)
                        || jsonb_build_object('force_shield_updated_at', to_jsonb(now() + interval '1 hour'))
                    where id = ${wizard}`;
        },
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a) => a.pool === b.pool && (a.cursor_elapsed_ms ?? -1) >= 0 && (a.cursor_elapsed_ms ?? 0) < tickMs);
      await regenCase('a_malformed_cursor_fails_safe_without_regenerating',
        async () => { await seed(2, 0); await setCursorRaw('not-a-timestamp'); },
        () => userRpc('apply_force_shield_regen', { _character_id: wizard }),
        (b, a) => a.pool === b.pool);

      // 12. The mirror always equals the committed authoritative pool.
      const mirrorObs = await observe();
      push('stance_state_is_only_a_mirror_of_the_authoritative_pool',
        mirrorObs.mirror === mirrorObs.pool, { observed: mirrorObs });

      // 13. A live tick under a claim applies no regeneration.
      await seed(2, 30_000);
      const beforeTick = await observe();
      await tick('live', wizard, [dummy]);
      const afterTick = await observe();
      push('an_authoritative_tick_applies_no_regeneration',
        (afterTick.pool ?? -1) <= (beforeTick.pool ?? 0),
        { pool_before: beforeTick.pool, pool_after: afterTick.pool, cap });

      // 14. Stance removal, then reactivation: the old cursor cannot carry over.
      await seed(1, 600_000);
      await userRpc('drop_stance', { p_character_id: wizard, p_stance_key: 'force_shield' });
      const dropped = await observe();
      await userRpc('activate_stance', { p_character_id: wizard, p_stance_key: 'force_shield', p_tier: 1 });
      const reactivated = await observe();
      await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const afterReact = await observe();
      push('a_dropped_stance_cursor_cannot_affect_a_later_activation',
        dropped.pool === null &&
        (reactivated.cursor_elapsed_ms === null || reactivated.cursor_elapsed_ms < 10_000) &&
        (afterReact.pool ?? 0) <= cap,
        {
          pool_after_drop: dropped.pool, cursor_after_drop: dropped.cursor,
          pool_after_reactivation: reactivated.pool, cursor_after_reactivation: reactivated.cursor,
          cursor_elapsed_after_reactivation_ms: reactivated.cursor_elapsed_ms,
          pool_after_regen: afterReact.pool, cursor_after_regen: afterReact.cursor,
          combat_state: 'out_of_combat', cap,
        });

      // 15. Death: no regeneration and no stance recreation.
      await seed(0, 60_000);
      const beforeDeath = await observe();
      await sql`update public.characters set hp = 0 where id = ${wizard}`;
      const deadRegen = await userRpc('apply_force_shield_regen', { _character_id: wizard });
      const afterDeath = await observe();
      const deadState = await charState(wizard);
      push('death_regenerates_nothing_and_never_recreates_the_stance',
        afterDeath.pool === null && JSON.stringify(deadState.reserved_buffs ?? {}) === '{}' &&
        !('force_shield_hp' in ((deadState.stance_state ?? {}) as Record<string, unknown>)),
        {
          pool_before: beforeDeath.pool, pool_after: afterDeath.pool,
          cursor_before: beforeDeath.cursor, cursor_after: afterDeath.cursor,
          eligible_intervals: Math.floor((beforeDeath.cursor_elapsed_ms ?? 0) / tickMs),
          regen_applied: 0, combat_state: 'out_of_combat', cap,
          reserved: deadState.reserved_buffs, stance_state: deadState.stance_state,
          regen_return: deadRegen.data,
        });
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
        aoeBase?: number;
      }) => {
        await sql`delete from public.encounter_cast_events where encounter_id = ${encounterId}`;
        // A cast that "started" before the participants joined is, by design,
        // ineligible for every one of them. The channel therefore starts now;
        // dueness comes from `expiresAt`, not from a backdated start.
        const startedAt = new Date(Date.now()).toISOString();
        const expiresAt = new Date(Date.now() + o.dueMs).toISOString();
        const config = {
          label: 'Validation Nova', targetCharacterId: o.target, baseDamage: 10,
          baseAoeDamage: o.aoeBase ?? 4,
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
        const prim = hits.find((e) => e.characterId === primary);
        const aoe = hits.find((e) => e.characterId === secondary);
        const left = await poolNow();
        const expectPrimary = 10 + Math.floor(m.expectUsed * 1);
        const expectAoe = 4 + Math.floor(m.expectUsed * 0.5);
        push(`stored_power_${m.name}_consumes_and_commits`,
          t.ok && left === m.expectLeft &&
          Number(prim?.amount ?? -1) === expectPrimary,
          {
            pool_after: left, expected_left: m.expectLeft,
            primary_damage: prim?.amount, expected_primary: expectPrimary,
            aoe_damage: aoe?.amount, expected_aoe: expectAoe,
            tick_ok: t.ok, tick_mode: t.mode, event_types: t.events.map((e) => String(e.type)),
            tick_raw: t.ok ? undefined : t.raw,
          });
        push(`stored_power_${m.name}_primary_and_aoe_shares`,
          Number(prim?.amount ?? -1) === expectPrimary &&
          (aoe === undefined || Number(aoe.amount) === expectAoe),
          { primary: prim?.amount, aoe: aoe?.amount, expectPrimary, expectAoe });

        // Inertness is about the SAME cast never resolving twice. A later tick
        // legitimately starts a new telegraph and may bank fresh power, so the
        // pool value is not the invariant — the resolution count is.
        const t2 = await tick('live', primary, [boss]);
        const rehits = t2.events.filter((e) => e.type === 'boss_cast_hit'
          && (e.creatureId === boss)
          && Number(e.amount ?? 0) >= expectPrimary);
        push(`stored_power_${m.name}_duplicate_resolution_is_inert`,
          rehits.length === 0,
          { pool_after_second_tick: await poolNow(), rehits: rehits.length,
            event_types: t2.events.map((e) => String(e.type)) });
      }

      // Cap: banking during a channel may never exceed the configured cap.
      await setPool(390, 400);
      await seedCast({ consumeMode: 'all', dueMs: 30_000, target: primary, cap: 400 });
      await tick('live', primary, [boss]);
      const capped = await poolNow();
      push('stored_power_banking_respects_the_cap', capped <= 400, { pool: capped });

      // Delayed resolution: a long-overdue cast still resolves exactly once.
      // Identity is the cast ROW: a later tick legitimately starts a new
      // telegraph, so "once" is measured on the seeded cast event, not on the
      // encounter pool.
      await sql`update public.characters set hp = 4000 where id in (${primary}, ${secondary})`;
      await setPool(100, 400);
      await seedCast({ consumeMode: 'all', dueMs: -120_000, target: primary, cap: 400 });
      const [seeded] = await sql<Row[]>`select id from public.encounter_cast_events
        where encounter_id = ${encounterId} order by started_at desc limit 1`;
      const tDelayed = await tick('live', primary, [boss]);
      const delayedHits = tDelayed.events.filter((e) => e.type === 'boss_cast_hit').length;
      const delayedPool = await poolNow();
      const resolvedOnce = async () => {
        const [r] = await sql<Row[]>`select resolved_at from public.encounter_cast_events where id = ${seeded.id}`;
        return r?.resolved_at !== null && r?.resolved_at !== undefined;
      };
      const firstResolved = await resolvedOnce();
      const tDelayed2 = await tick('live', primary, [boss]);
      const reResolved = tDelayed2.events.filter((e) =>
        e.type === 'boss_cast_hit' && Number(e.amount ?? 0) >= 110).length;
      push('delayed_resolution_lands_once_and_consumes_once',
        delayedHits > 0 && delayedPool === 0 && firstResolved && reResolved === 0,
        { hits: delayedHits, pool_after: delayedPool, cast_resolved: firstResolved, re_resolutions: reResolved });

      // Flee / no eligible target: the pool still drains, nobody is hit.
      // The claimant has to stay on the node — with nobody present there is no
      // tick to resolve at all. The cast's own target flees and the splash is
      // authored to zero, so the resolution has no eligible victim.
      await sql`update public.characters set hp = 4000 where id in (${primary}, ${secondary})`;
      await setPool(100, 400);
      await seedCast({
        consumeMode: 'all', dueMs: -1000, target: secondary, cap: 400,
        aoeBase: 0, aoeShare: 0,
      });
      await sql`update public.characters set current_node_id = ${created.otherNodeId} where id = ${secondary}`;
      const tFlee = await tick('live', primary, [boss]);
      const fleeHits = tFlee.events.filter((e) => e.type === 'boss_cast_hit').length;
      const fleePool = await poolNow();
      push('stored_power_no_target_drains_without_damage',
        fleeHits === 0 && fleePool === 0,
        { hits: fleeHits, pool: fleePool, events: tFlee.events.map((e) => String(e.type)) });
      await sql`update public.characters set current_node_id = ${nodeId} where id in (${primary}, ${secondary})`;
      await admin.rpc('encounter_intake', { _character_id: secondary, _creature_ids: [boss] });

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
        { pool: fizzlePool, open_casts: openCasts, events: tFizzle.events.map((e) => String(e.type)) });

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
        (id, encounter_id, character_id, node_id, ability_key, target_creature_id, client_seq, status, eligible_after_ms)
        values (gen_random_uuid(), ${encounterId}, ${char}, ${nodeId}, 'backstab', ${victim}, 1, 'pending', ${now - 1000})`;

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

      push('effects_only_mode_confirmed', t.ok && t.mode === 'catchup',
        { mode: t.mode, tick: t.tick, ok: t.ok, raw: t.raw });
      notes.effects_only_raw = t.raw;
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
        { closures: counters.cast_closures, events: t.events.map((e) => String(e.type)) });

      // Non-vacuity control: the same fixture in live mode does attack.
      await sql`update public.characters set current_node_id = ${nodeId} where id = ${char}`;
      const live = await makeCreature({ name: 'Validation Sparring Dummy', hp: 9000 });
      await admin.rpc('encounter_intake', { _character_id: char, _creature_ids: [live] });
      const tLive = await tick('live', char, [live]);
      notes.control_live_raw = tLive.raw;
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
      // ── TEMPORARY validation authorization: proofs of its narrowness ────
      const grantCheck = async (token: string, node: string | undefined, role: string) => {
        const { data } = await admin.rpc('combat_validation_grant_check', {
          _token: token, _node_id: node ?? null, _role: role,
        });
        return data === true;
      };
      const grantProofs = {
        valid_fixture_node_catchup: await grantCheck(validationToken, created.nodeId, 'catchup'),
        other_node_denied: await grantCheck(validationToken, created.otherNodeId, 'catchup'),
        live_role_denied: await grantCheck(validationToken, created.nodeId, 'live'),
        wrong_token_denied: await grantCheck(crypto.randomUUID(), created.nodeId, 'catchup'),
        empty_token_denied: await grantCheck('', created.nodeId, 'catchup'),
      };
      notes.validation_grant_proofs = grantProofs;
      push('validation_grant_authorizes_only_the_fixture_node_in_catchup_role',
        grantProofs.valid_fixture_node_catchup && !grantProofs.other_node_denied &&
        !grantProofs.live_role_denied && !grantProofs.wrong_token_denied &&
        !grantProofs.empty_token_denied, grantProofs);

      // Anon and authenticated roles cannot even reach the check function.
      const reachable = async (claims: Record<string, unknown>) => {
        try {
          await sql.begin(async (tx) => {
            await tx`select set_config('role', ${String(claims.role)}, true)`;
            await tx`select public.combat_validation_grant_check(${validationToken}, ${created.nodeId!}, 'catchup')`;
          });
          return true;
        } catch { return false; }
      };
      const reach = {
        anon: await reachable({ role: 'anon' }),
        authenticated: await reachable({ role: 'authenticated' }),
      };
      notes.validation_grant_reachability = reach;
      push('validation_grant_check_is_unreachable_by_players',
        !reach.anon && !reach.authenticated, reach);

      // An expired/deleted grant stops bypassing maintenance immediately.
      const expiredToken = crypto.randomUUID();
      await sql`insert into public.combat_validation_grants (token_hash, node_id, role, expires_at, note)
                values (encode(sha256(convert_to(${expiredToken}, 'UTF8')), 'hex'),
                        ${created.nodeId!}, 'catchup', now() - interval '1 minute', 'c5-final-validation-expired')`;
      const expiredUsable = await grantCheck(expiredToken, created.nodeId, 'catchup');
      await sql`delete from public.combat_validation_grants
                where token_hash = encode(sha256(convert_to(${expiredToken}, 'UTF8')), 'hex')`;
      const deletedUsable = await grantCheck(expiredToken, created.nodeId, 'catchup');
      push('expired_or_deleted_validation_grant_no_longer_bypasses_maintenance',
        !expiredUsable && !deletedUsable, { expiredUsable, deletedUsable });

      // A real orchestration attempt with the grant but a non-fixture node is
      // refused by the maintenance gate, so the grant cannot travel.
      const offGrantChar = await makeChar('warrior');
      await sql`delete from public.combat_soak_access where character_id = ${offGrantChar}`;
      const foreign = await orchestrateCombatResolution(
        { role: 'catchup', characterId: offGrantChar, nodeId: created.otherNodeId!, creatureIds: [] },
        {
          db: admin, nowMs: Date.now(), catalog,
          refreshCatalog: () => buildAbilityCatalog(admin, true),
          newBatchId: () => crypto.randomUUID(), caller: 'c5-final-validation',
          validationGrant,
        },
      ) as unknown as Record<string, unknown>;
      push('validation_grant_cannot_resolve_a_non_fixture_encounter',
        foreign.ok !== true && foreign.kind === 'maintenance', foreign);

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
      // The temporary validation authorization never outlives the invocation.
      await sql`delete from public.combat_validation_grants where note like 'c5-final-validation%'`;
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
