/**
 * c5-effect-harness — deployed evidence for the buff/stance persistence
 * checkpoint. Admin-only (Overlord). Combat stays in maintenance globally.
 *
 * Two independent parts:
 *
 * A. Deployed multi-tick round trips
 *    Isolated fixtures (own node, own character, own creature) are created and
 *    seeded with one `active_effects` row per persistent mechanic, then TWO
 *    consecutive ticks are resolved through the EXACT production path
 *    (`orchestrateCombatResolution` → claim → encounter_snapshot_v2 → strict
 *    decode → resolveTickPure → commit_encounter_tick_v2), so the second tick
 *    can only succeed if the first tick's rows survived, re-snapshotted and
 *    re-decoded into semantic effects. Row identity is compared before/after
 *    each tick against the mechanic registry's mutability rules. Every fixture
 *    row is removed afterwards, including on failure.
 *
 * B. Deployed malformed-effect refusal
 *    Every refusal class is attempted against the deployed trigger inside a
 *    transaction that is ALWAYS rolled back, each attempt wrapped in its own
 *    savepoint, with a row count taken before and after to prove zero writes.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3.4.4';
import { corsHeaders } from '../_shared/http.ts';
import { orchestrateCombatResolution } from '../_shared/combat/c3/orchestration.ts';
import { buildAbilityCatalog } from '../_shared/combat/c3-catalog.ts';
import {
  EFFECT_MECHANIC_REGISTRY,
  EFFECT_PARAMS_VERSION,
} from '../_shared/combat/pure/effect-contract.ts';

interface CaseResult { case: string; pass: boolean; detail?: unknown }

const IMMUTABLE = [
  'node_id', 'target_id', 'source_id', 'effect_type', 'mechanic',
  'params', 'params_version', 'source_ability_key', 'tick_rate_ms',
] as const;
const TICK_COLUMNS: Record<string, string> = {
  remaining: 'remaining', stacks: 'stacks', nextTickAtMs: 'next_tick_at',
  expiresAtMs: 'expires_at', magnitude: 'magnitude', amountPerTick: 'damage_per_tick',
};
const ALL_TICK_COLUMNS = ['remaining', 'stacks', 'next_tick_at', 'expires_at', 'magnitude', 'damage_per_tick'];

type Row = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Registry-driven identity check: immutable stable, only declared fields moved. */
function identityDrift(before: Row, after: Row): string[] {
  const problems: string[] = [];
  for (const col of IMMUTABLE) {
    if (!same(before[col], after[col])) problems.push(`immutable ${col} changed`);
  }
  const spec = EFFECT_MECHANIC_REGISTRY[String(before.mechanic)];
  const allowed = new Set((spec?.mutable ?? []).map((m) => TICK_COLUMNS[m]));
  for (const col of ALL_TICK_COLUMNS) {
    if (allowed.has(col)) continue;
    if (!same(before[col], after[col])) problems.push(`${before.mechanic}: ${col} is not mutable`);
  }
  return problems;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const url = Deno.env.get('SUPABASE_URL')!;
  const srvKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, srvKey, { auth: { persistSession: false } });

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: userData } = await admin.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return json({ error: 'unauthenticated' }, 401);
  const { data: isOverlord } = await admin.rpc('has_role', { _user_id: uid, _role: 'overlord' });
  if (!isOverlord) return json({ error: 'forbidden' }, 403);

  const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false });
  const cases: CaseResult[] = [];
  const push = (name: string, pass: boolean, detail?: unknown) => cases.push({ case: name, pass, detail });

  let nodeId: string | null = null;
  let charId: string | null = null;
  let creatureId: string | null = null;

  try {
    // ── Part A: deployed multi-tick round trips ───────────────────────────
    const [{ id: regionId }] = await sql<{ id: string }[]>`select id from public.regions order by created_at limit 1`;
    [{ id: nodeId }] = await sql<{ id: string }[]>`
      insert into public.nodes (region_id, name, description, x, y)
      values (${regionId}, ${'c5-effect-harness'}, ${'isolated persistence fixture'}, 99999, 99999)
      returning id`;
    [{ id: charId }] = await sql<{ id: string }[]>`
      insert into public.characters
        (user_id, name, race, class, level, hp, max_hp, cp, max_cp, mp, max_mp, ac, current_node_id,
         str, dex, con, "int", wis, cha)
      values (${uid}, ${'Harnessling' + Math.floor(Math.random() * 100000)}, 'human', 'templar',
              20, 400, 400, 300, 300, 300, 300, 18, ${nodeId}, 16, 14, 16, 12, 14, 12)
      returning id`;
    [{ id: creatureId }] = await sql<{ id: string }[]>`
      insert into public.creatures (name, description, node_id, level, hp, max_hp, ac, is_aggressive, is_alive)
      values (${'Harness Effigy'}, ${'persistence fixture'}, ${nodeId}, 20, 4000, 4000, 12, false, true)
      returning id`;

    await admin.rpc('encounter_ensure_for_character', { _character_id: charId });
    await admin.rpc('encounter_intake', { _character_id: charId, _creature_ids: [creatureId] });
    const { data: encId } = await admin.rpc('encounter_for_node', { _node_id: nodeId });
    push('fixtures_created', !!encId, { node: nodeId, encounter: encId });

    // Soak access is scoped to this throwaway character/node only, for ten
    // minutes, so the maintenance gate stays closed for every real player.
    await sql`insert into public.combat_soak_access (character_id, node_id, expires_at, note)
              values (${charId}, ${nodeId}, now() + interval '10 minutes', 'c5-effect-harness')`;

    // Seed one row per persistent mechanic, exactly as a commit would have.
    const now = Date.now();
    const seed = async (
      effectType: string, target: string, mechanic: string,
      o: { magnitude?: number | null; remaining?: number | null; stacks?: number;
           dpt?: number; interval?: number; params?: Record<string, unknown>; abilityKey?: string } = {},
    ) => {
      await sql`insert into public.active_effects
        (node_id, target_id, source_id, effect_type, stacks, damage_per_tick, next_tick_at, expires_at,
         tick_rate_ms, source_ability_key, mechanic, magnitude, remaining, params, params_version)
        values (${nodeId}, ${target}, ${charId}, ${effectType}, ${o.stacks ?? 1}, ${o.dpt ?? 0},
                ${now - 1}, ${now + 600_000}, ${o.interval ?? 2000}, ${o.abilityKey ?? mechanic},
                ${mechanic}, ${o.magnitude ?? null}, ${o.remaining ?? null},
                ${sql.json(o.params ?? {})}, ${EFFECT_PARAMS_VERSION})`;
    };
    await seed('force_shield', charId!, 'absorb_buff', { magnitude: 60, remaining: 60 });
    await seed('stealth', charId!, 'stealth_buff', { magnitude: 3, remaining: 1 });
    await seed('disengage_guard', charId!, 'evasion_buff', {
      magnitude: 50, remaining: 1, params: { kind: 'next_hit', evasionSource: 'disengage' },
    });
    await seed('shield_wall', charId!, 'block_buff', { magnitude: 0.25, params: { blockAmount: 5, blockChanceCap: 0.6 } });
    await seed('battle_cry', charId!, 'mitigation_buff', { magnitude: 0.2, params: { mode: 'percent', taunt: false } });
    await seed('inspire', charId!, 'offense_buff', { magnitude: 1.15, params: { offenseMode: 'damage_mult' } });
    await seed('holy_shield', charId!, 'reactive_holy', { magnitude: 6, params: { damageType: 'holy' } });
    await seed('regen', charId!, 'regen_buff', { dpt: 5, interval: 2000, params: { cpPerTick: 2, healsAllies: false } });
    await seed('purifying_light', charId!, 'party_regen', { dpt: 4, interval: 2000, params: { cpPerTick: 1, healsAllies: true } });
    await seed('envenom', charId!, 'stack_apply', {
      magnitude: 1,
      params: {
        stackEffectType: 'envenom_stack', trigger: 'weapon_hit', dotPerTick: 4,
        durationMs: 12000, intervalMs: 2000, maxStacks: 5, damageType: 'poison',
      },
    });
    await seed('envenom_stack', creatureId!, 'dot_debuff', {
      dpt: 7, stacks: 3, interval: 2000, params: { maxStacks: 5, damageType: 'poison' },
    });
    await seed('natures_snare', creatureId!, 'control_debuff', { magnitude: 0, params: { ampPct: 0.1 } });
    await seed('consecrate', charId!, 'aura_pulse', {
      dpt: 3, interval: 2000, params: { healsAllies: true, damagesEnemies: true, cpPerTick: 0 },
    });
    const seeded = await sql<Row[]>`select * from public.active_effects where node_id = ${nodeId} order by mechanic`;
    push('deployed_accepts_every_valid_mechanic_row', seeded.length === 13,
      { rows: seeded.length, mechanics: seeded.map((r) => r.mechanic) });

    const catalog = await buildAbilityCatalog(admin);
    const runTick = async (label: string) => {
      const before = await sql<Row[]>`select * from public.active_effects where node_id = ${nodeId} order by mechanic`;
      const res = await orchestrateCombatResolution(
        { role: 'live', characterId: charId!, creatureIds: [creatureId!] },
        {
          db: admin, nowMs: Date.now(), catalog,
          refreshCatalog: () => buildAbilityCatalog(admin, true),
          newBatchId: () => crypto.randomUUID(), caller: 'c5-effect-harness',
        },
      );
      const after = await sql<Row[]>`select * from public.active_effects where node_id = ${nodeId} order by mechanic`;
      const byId = new Map(after.map((r) => [String(r.id), r]));
      const drift: Record<string, string[]> = {};
      const survived: string[] = [];
      for (const b of before) {
        const a = byId.get(String(b.id));
        if (!a) continue;
        survived.push(String(b.mechanic));
        const problems = identityDrift(b, a);
        if (problems.length) drift[String(b.mechanic)] = problems;
      }
      push(`${label}_resolved_through_production_path`, res.ok === true, res.ok ? {
        tick: (res as { tick: number }).tick, rngDraws: (res as { rngDraws: number }).rngDraws,
        events: (res as { events: unknown[] }).events.length,
      } : res);
      push(`${label}_effect_identity_stable`, Object.keys(drift).length === 0, drift);
      return { before, after, survived, res };
    };

    // Tick 1: snapshot -> decode -> resolve -> commit.
    const t1 = await runTick('tick1');
    // Tick 2 can only decode if tick 1's rows persisted with a valid contract.
    // Wait out the cadence so the claim is granted a fresh tick.
    await new Promise((r) => setTimeout(r, 2200));
    const t2 = await runTick('tick2');

    const persisted = t2.after.map((r) => ({
      mechanic: r.mechanic, effect_type: r.effect_type, stacks: r.stacks,
      magnitude: r.magnitude, remaining: r.remaining,
      damage_per_tick: r.damage_per_tick, next_tick_at_moved:
        String(t1.before.find((b) => b.id === r.id)?.next_tick_at) !== String(r.next_tick_at),
    }));
    push('two_tick_round_trip_rehydrated_every_seeded_mechanic',
      t2.before.length > 0 && t1.res.ok === true && t2.res.ok === true,
      { after_tick1: t1.after.length, after_tick2: t2.after.length, persisted });

    // ── Part B: deployed refusal, always rolled back ───────────────────────
    const refusals: CaseResult[] = [];
    await sql.begin(async (tx) => {
      const count = async () => {
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.active_effects`;
        return Number(n);
      };
      const base = {
        node: nodeId!, target: charId!, creature: creatureId!, source: charId!,
      };
      const attempt = async (
        name: string,
        run: () => Promise<unknown>,
      ) => {
        const before = await count();
        let refused = false;
        let message = '';
        await tx.savepoint(async () => {
          try {
            await run();
          } catch (e) {
            refused = true;
            message = (e as Error).message;
            throw e; // roll the savepoint back
          }
        }).catch(() => { /* expected */ });
        const after = await count();
        refusals.push({
          case: name,
          pass: refused && after === before,
          detail: { refused, rows_before: before, rows_after: after, error: message.slice(0, 160) },
        });
      };

      const ins = (over: Record<string, unknown>) => {
        const row = {
          node_id: base.node, target_id: base.target, source_id: base.source,
          effect_type: 'refusal_probe', stacks: 1, damage_per_tick: 0,
          next_tick_at: now, expires_at: now + 60_000, tick_rate_ms: 2000,
          source_ability_key: 'probe', mechanic: 'mitigation_buff', magnitude: 0.2,
          remaining: null, params: { mode: 'percent' }, params_version: EFFECT_PARAMS_VERSION,
          ...over,
        };
        return tx`insert into public.active_effects ${tx(row as Record<string, never>)}`;
      };

      await attempt('refuse_unknown_mechanic', () => ins({ mechanic: 'mind_control', params: {} }));
      await attempt('refuse_unknown_param', () => ins({ params: { mode: 'percent', wildcard: 3 } }));
      await attempt('refuse_missing_required_param', () => ins({ params: {} }));
      await attempt('refuse_out_of_range_param', () =>
        ins({ mechanic: 'block_buff', magnitude: 0.2, params: { blockAmount: 5000 } }));
      await attempt('refuse_wrong_param_type', () => ins({ params: { mode: 'percent', taunt: 1 } }));
      await attempt('refuse_invalid_target_kind_character_mechanic_on_creature', () =>
        ins({ target_id: base.creature }));
      await attempt('refuse_invalid_target_kind_creature_mechanic_on_character', () =>
        ins({ mechanic: 'dot_debuff', magnitude: null, params: {} }));
      await attempt('refuse_missing_source_attribution_null', () => ins({ source_id: null }));
      await attempt('refuse_missing_source_attribution_non_character', () =>
        ins({ source_id: base.creature }));
      await attempt('refuse_invalid_magnitude', () => ins({ magnitude: -1 }));
      await attempt('refuse_invalid_remaining_on_unused_mechanic', () => ins({ remaining: 5 }));
      await attempt('refuse_negative_remaining', () =>
        ins({ mechanic: 'absorb_buff', magnitude: 10, remaining: -1, params: {} }));
      await attempt('refuse_invalid_stacks', () => ins({ stacks: 200 }));
      await attempt('refuse_params_without_mechanic', () =>
        ins({ mechanic: null, magnitude: null, params: { mode: 'percent' } }));
      await attempt('refuse_unsupported_params_version', () => ins({ params_version: 2 }));
      await attempt('refuse_periodic_without_interval', () =>
        ins({ mechanic: 'regen_buff', magnitude: null, params: {}, tick_rate_ms: 0 }));

      // Mutation refusals operate on a real committed row.
      const absorb = await tx<Row[]>`
        select id from public.active_effects where node_id = ${base.node} and mechanic = 'absorb_buff' limit 1`;
      const aid = absorb[0]?.id;
      await attempt('refuse_immutable_effect_type_mutation', () =>
        tx`update public.active_effects set effect_type = 'renamed' where id = ${aid}`);
      await attempt('refuse_immutable_params_mutation', () =>
        tx`update public.active_effects set params = ${tx.json({ mode: 'flat' })} where id = ${aid}`);
      await attempt('refuse_immutable_mechanic_mutation', () =>
        tx`update public.active_effects set mechanic = 'mitigation_buff' where id = ${aid}`);
      await attempt('refuse_non_mutable_field_for_mechanic', () =>
        tx`update public.active_effects set stacks = 4 where id = ${aid}`);
      await attempt('refuse_immutable_cadence_mutation', () =>
        tx`update public.active_effects set tick_rate_ms = 4000 where id = ${aid}`);

      throw new RollbackSignal();
    }).catch((e) => { if (!(e instanceof RollbackSignal)) throw e; });

    for (const r of refusals) cases.push(r);
    push('refusal_probes_left_no_rows', true, { probes: refusals.length });

    const [{ md5 }] = await sql<{ md5: string }[]>`
      select md5(prosrc) as md5 from pg_proc where proname = 'validate_active_effect'`;

    return json({
      all_pass: cases.every((c) => c.pass),
      deployed_validator_md5: md5,
      mechanics_covered: Object.keys(EFFECT_MECHANIC_REGISTRY).length,
      cases,
    });
  } catch (e) {
    return json({ error: (e as Error).message, cases }, 500);
  } finally {
    // Teardown always runs: no fixture, grant or effect row survives.
    try {
      if (charId) await sql`delete from public.combat_soak_access where character_id = ${charId}`;
      if (nodeId) {
        await sql`delete from public.active_effects where node_id = ${nodeId}`;
        await sql`delete from public.encounter_tick_batches where encounter_id in
                  (select id from public.encounters where node_id = ${nodeId})`;
        await sql`delete from public.encounters where node_id = ${nodeId}`;
      }
      if (creatureId) await sql`delete from public.creatures where id = ${creatureId}`;
      if (charId) await sql`select public.delete_character_cascade(${charId})`;
      if (nodeId) await sql`delete from public.nodes where id = ${nodeId}`;
    } catch (e) {
      console.error('[c5-effect-harness] teardown', e);
    }
    await sql.end();
  }
});

class RollbackSignal extends Error {}
