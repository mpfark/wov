/**
 * Persistence round-trip harness for semantic combat effects.
 *
 * The chain proved here is the production chain, one link per function:
 *
 *   resolveTickPure  ->  effectUpserts / effectDeleteIds
 *                    ->  commitEffects            (mirror of commit_encounter_tick_v2)
 *                    ->  active_effects rows      (DB row shape)
 *                    ->  projectSnapshotEffects   (mirror of encounter_snapshot_v2)
 *                    ->  decodeEffectsSection     (the production decoder, imported)
 *                    ->  EffectSnapshot[]         -> next resolveTickPure
 *
 * Only the two SQL steps are mirrored here, and both mirror a single anchor in
 * the deployed function verbatim (see the migration that installed them). Every
 * commit is additionally passed through `validateEffectRow`, so a row the
 * deployed trigger would refuse fails the test instead of silently persisting.
 *
 * `assertOnlyMutableFieldsChanged` is what makes "the row survived" meaningful:
 * it proves the immutable identity of an effect (mechanic, magnitude, params,
 * params version, source, target) is byte-stable across the round trip, and
 * that the only fields which moved are the ones the registry marks mutable.
 */

import { resolveTickPure as resolve } from '@/shared/combat/pure';
import {
  buildBuffSnapshotFromEffects,
  EFFECT_MECHANIC_REGISTRY,
  EFFECT_PARAMS_VERSION,
  validateEffectRow,
  type EffectMechanicSpec,
} from '@/shared/combat/pure/effect-contract';
import { decodeEffectsSection, type EffectStatusDef } from '@/shared/combat/c3/decode-snapshot';
import type {
  EffectSnapshot,
  EffectUpsert,
  EncounterSnapshot,
  ProposedTick,
} from '@/shared/combat/pure/types';

/** Assertion helper — deliberately vitest-free so scripts can use the harness. */
function must(condition: boolean, message: string): void {
  if (!condition) throw new Error(`effect round trip: ${message}`);
}

/** `public.active_effects`, exactly the columns the chain reads or writes. */
export interface EffectRow {
  id: string;
  node_id: string;
  target_id: string;
  source_id: string | null;
  effect_type: string;
  stacks: number;
  damage_per_tick: number;
  next_tick_at: number;
  expires_at: number;
  tick_rate_ms: number;
  source_ability_key: string | null;
  damage_type: string | null;
  mechanic: string | null;
  magnitude: number | null;
  remaining: number | null;
  params: Record<string, number | boolean | string>;
  params_version: number;
  created_at_ms: number;
}

/** Identity of a row under the deployed unique index. */
const identity = (r: { source_id: string | null; target_id: string; effect_type: string }) =>
  `${r.source_id ?? 'null'}|${r.target_id}|${r.effect_type}`;

export interface CommitResult {
  readonly rows: EffectRow[];
  readonly inserted: string[];
  readonly updated: string[];
  readonly deleted: string[];
}

/**
 * Mirror of the deployed effect commit: delete by id, then upsert on
 * `(source_id, target_id, effect_type)`.
 *
 * `mechanic`, `magnitude` and `params` are `COALESCE(new, old)` — an update may
 * never blank an identity field. `remaining` is rewritten every tick. Any row
 * the trigger contract would refuse throws here.
 */
export function commitEffects(
  rows: readonly EffectRow[],
  proposed: Pick<ProposedTick, 'effectUpserts' | 'effectDeleteIds'>,
  ctx: { nodeId: string; creatureIds: ReadonlySet<string>; nowMs: number },
): CommitResult {
  const deleted: string[] = [];
  const byId = new Map(rows.map((r) => [r.id, { ...r, params: { ...r.params } }]));
  for (const id of proposed.effectDeleteIds) {
    if (byId.delete(id)) deleted.push(id);
  }

  const byIdentity = new Map<string, EffectRow>();
  for (const row of byId.values()) byIdentity.set(identity(row), row);

  const inserted: string[] = [];
  const updated: string[] = [];
  let seq = 0;
  for (const up of proposed.effectUpserts) {
    assertUpsertAccepted(up, ctx.creatureIds);
    const key = identity({
      source_id: up.sourceCharacterId ?? null,
      target_id: up.targetId,
      effect_type: up.effectType,
    });
    const existing = byIdentity.get(key);
    if (existing) {
      existing.stacks = up.stacks;
      existing.damage_per_tick = Math.trunc(up.amountPerTick);
      existing.expires_at = up.expiresAtMs;
      existing.next_tick_at = up.nextTickAtMs;
      existing.tick_rate_ms = up.intervalMs || existing.tick_rate_ms;
      existing.mechanic = up.mechanic ?? existing.mechanic;
      existing.magnitude = up.magnitude ?? existing.magnitude;
      existing.params = (up.params as Record<string, number | boolean | string>) ?? existing.params;
      existing.params_version = up.paramsVersion ?? EFFECT_PARAMS_VERSION;
      existing.remaining = up.remaining ?? null;
      existing.source_ability_key = up.abilityKey ?? existing.source_ability_key;
      updated.push(existing.id);
      continue;
    }
    const row: EffectRow = {
      id: `row-${ctx.nowMs}-${seq++}`,
      node_id: ctx.nodeId,
      target_id: up.targetId,
      source_id: up.sourceCharacterId ?? null,
      effect_type: up.effectType,
      stacks: up.stacks,
      damage_per_tick: Math.trunc(up.amountPerTick),
      next_tick_at: up.nextTickAtMs,
      expires_at: up.expiresAtMs,
      tick_rate_ms: up.intervalMs || 2000,
      source_ability_key: up.abilityKey ?? null,
      damage_type: up.damageType ?? null,
      mechanic: up.mechanic ?? null,
      magnitude: up.magnitude ?? null,
      remaining: up.remaining ?? null,
      params: (up.params as Record<string, number | boolean | string>) ?? {},
      params_version: up.paramsVersion ?? EFFECT_PARAMS_VERSION,
      created_at_ms: ctx.nowMs,
    };
    byIdentity.set(key, row);
    byId.set(row.id, row);
    inserted.push(row.id);
  }

  return { rows: [...byId.values()], inserted, updated, deleted };
}

/** The contract check both the TS decoder and the SQL trigger apply. */
export function assertUpsertAccepted(up: EffectUpsert, creatureIds: ReadonlySet<string>): void {
  if (!up.mechanic) return;
  validateEffectRow(
    {
      mechanic: up.mechanic,
      targetKind: creatureIds.has(up.targetId) ? 'creature' : 'character',
      sourceCharacterId: up.sourceCharacterId ?? null,
      magnitude: up.magnitude ?? null,
      remaining: up.remaining ?? null,
      intervalMs: up.intervalMs,
      paramsVersion: up.paramsVersion ?? EFFECT_PARAMS_VERSION,
      params: up.params ?? {},
    },
    'proposed.effectUpsert',
  );
}

/** Mirror of the `encounter_snapshot_v2` effect projection. */
export function projectSnapshotEffects(rows: readonly EffectRow[]): unknown[] {
  return rows.map((r) => ({
    id: r.id,
    targetId: r.target_id,
    sourceId: r.source_id,
    effectType: r.effect_type,
    stacks: r.stacks,
    amountPerTick: r.damage_per_tick,
    expiresAtMs: r.expires_at,
    intervalMs: r.tick_rate_ms,
    nextTickAtMs: r.next_tick_at,
    sourceAbilityKey: r.source_ability_key,
    damageType: r.damage_type,
    mechanic: r.mechanic,
    magnitude: r.magnitude,
    remaining: r.remaining,
    params: r.params ?? {},
    paramsVersion: r.params_version,
    rowVersion: r.created_at_ms,
  }));
}

/** Rows -> snapshot JSON -> the production decoder. */
export function decodeRows(
  rows: readonly EffectRow[],
  ctx: { creatureIds: ReadonlySet<string>; statusDefs?: readonly EffectStatusDef[] },
): EffectSnapshot[] {
  const statusByKey = new Map((ctx.statusDefs ?? []).map((d) => [d.key, d]));
  return decodeEffectsSection(projectSnapshotEffects(rows), {
    creatureIds: ctx.creatureIds,
    statusByKey,
  }).effects;
}

/** One full link: resolve, commit, project, decode. */
export function roundTrip(
  snap: EncounterSnapshot,
  rows: readonly EffectRow[],
  opts: { statusDefs?: readonly EffectStatusDef[] } = {},
): { out: ProposedTick; commit: CommitResult; effects: EffectSnapshot[] } {
  const creatureIds = new Set(snap.creatures.map((c) => c.id));
  const out = resolve(snap);
  const commit = commitEffects(rows, out, {
    nodeId: snap.nodeId,
    creatureIds,
    nowMs: snap.nowMs,
  });
  const statusDefs = opts.statusDefs ?? snap.config.statusDefs;
  const effects = decodeRows(commit.rows, { creatureIds, statusDefs });
  return { out, commit, effects };
}

const IMMUTABLE_COLUMNS = [
  'id',
  'node_id',
  'target_id',
  'source_id',
  'effect_type',
  'mechanic',
  'params',
  'params_version',
  'source_ability_key',
] as const;

const MUTABLE_COLUMN_OF: Record<string, keyof EffectRow> = {
  remaining: 'remaining',
  stacks: 'stacks',
  nextTickAtMs: 'next_tick_at',
  expiresAtMs: 'expires_at',
  magnitude: 'magnitude',
  amountPerTick: 'damage_per_tick',
};

/**
 * Prove an effect's identity survived the round trip and that only the fields
 * its mechanic declares mutable have moved.
 */
export function assertOnlyMutableFieldsChanged(before: EffectRow, after: EffectRow): void {
  must(after.mechanic === before.mechanic, 'mechanic must survive the round trip');
  for (const col of IMMUTABLE_COLUMNS) {
    must(
      JSON.stringify(after[col]) === JSON.stringify(before[col]),
      `immutable column ${col} changed: ${JSON.stringify(before[col])} -> ${JSON.stringify(after[col])}`,
    );
  }
  const spec: EffectMechanicSpec | undefined = before.mechanic
    ? EFFECT_MECHANIC_REGISTRY[before.mechanic]
    : undefined;
  const allowed = new Set<keyof EffectRow>(
    (spec?.mutable ?? []).map((m) => MUTABLE_COLUMN_OF[m]).filter(Boolean) as (keyof EffectRow)[],
  );
  // tick_rate_ms is cadence identity: a periodic row may never change interval.
  must(after.tick_rate_ms === before.tick_rate_ms, 'tick_rate_ms (cadence identity) changed');
  for (const col of ['remaining', 'stacks', 'next_tick_at', 'expires_at', 'magnitude', 'damage_per_tick'] as const) {
    if (allowed.has(col)) continue;
    must(after[col] === before[col], `${before.mechanic}: ${col} is not a mutable field for this mechanic`);
  }
}

/**
 * Build the next tick's snapshot exactly as the decoder does: participant buff
 * bags are rebuilt from the persisted effects and from nothing else.
 */
export function nextSnapshot(
  snap: EncounterSnapshot,
  effects: readonly EffectSnapshot[],
  over: { advanceMs?: number; actions?: EncounterSnapshot['actions'] } = {},
): EncounterSnapshot {
  const advanceMs = over.advanceMs ?? snap.tickRateMs;
  const nowMs = snap.nowMs + advanceMs;
  return {
    ...snap,
    nowMs,
    tickNumber: snap.tickNumber + 1,
    ticksToSimulate: 1,
    actions: over.actions ?? [],
    effects: [...effects],
    participants: snap.participants.map((p) => ({
      ...p,
      buffs: buildBuffSnapshotFromEffects(p.id, effects, nowMs),
    })),
  } as EncounterSnapshot;
}

/** Find the single row belonging to a mechanic, failing loudly when ambiguous. */
export function rowFor(rows: readonly EffectRow[], mechanic: string): EffectRow {
  const found = rows.filter((r) => r.mechanic === mechanic);
  must(found.length === 1, `expected exactly one ${mechanic} row, found ${found.length}`);
  return found[0];
}
