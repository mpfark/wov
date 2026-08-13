/**
 * pure/ordering.ts — stable ordering for every collection the resolver walks.
 *
 * RNG stream keys include entity ids, so an ordering change cannot silently
 * shift a roll onto another entity. Ordering still matters for *sequencing*
 * (who swings first, which creature dies first), so every list is sorted by
 * an explicit, total, id-terminated comparator. Object key order, query
 * order and insertion order never reach the simulation.
 */

import type {
  ActionSnapshot,
  CreatureSnapshot,
  EffectSnapshot,
  EngagementSnapshot,
  ParticipantSnapshot,
  ProcSnapshot,
} from './types';

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const num = (a: number, b: number): number => {
  const av = Number.isFinite(a) ? a : 0;
  const bv = Number.isFinite(b) ? b : 0;
  return av - bv;
};

/** Participants: join order, then id. */
export function orderParticipants(
  rows: readonly ParticipantSnapshot[],
): ParticipantSnapshot[] {
  return [...rows].sort((a, b) => num(a.joinedAtMs, b.joinedAtMs) || byId(a.id, b.id));
}

/** Creatures: boss first (telegraphs resolve before trash), then level, then id. */
const RARITY_RANK: Record<string, number> = { boss: 0, rare: 1, regular: 2 };

export function orderCreatures(rows: readonly CreatureSnapshot[]): CreatureSnapshot[] {
  return [...rows].sort(
    (a, b) =>
      num(RARITY_RANK[a.rarity] ?? 9, RARITY_RANK[b.rarity] ?? 9) ||
      num(b.level, a.level) ||
      byId(a.id, b.id),
  );
}

/** Durable actions: queue sequence, then id. */
export function orderActions(rows: readonly ActionSnapshot[]): ActionSnapshot[] {
  return [...rows].sort((a, b) => num(a.sequence, b.sequence) || byId(a.id, b.id));
}

/** Effects: target kind, target, effect type, then id. */
export function orderEffects(rows: readonly EffectSnapshot[]): EffectSnapshot[] {
  return [...rows].sort(
    (a, b) =>
      byId(a.targetKind, b.targetKind) ||
      byId(a.targetId, b.targetId) ||
      byId(a.effectType, b.effectType) ||
      byId(a.id, b.id),
  );
}

/** Engagements: creature, then character. */
export function orderEngagements(
  rows: readonly EngagementSnapshot[],
): EngagementSnapshot[] {
  return [...rows].sort(
    (a, b) => byId(a.creatureId, b.creatureId) || byId(a.characterId, b.characterId),
  );
}

/** Procs: owner, kind, then id — weighted picks need a fixed candidate order. */
export function orderProcs(rows: readonly ProcSnapshot[]): ProcSnapshot[] {
  return [...rows].sort(
    (a, b) =>
      byId(a.characterId, b.characterId) || byId(a.kind, b.kind) || byId(a.id, b.id),
  );
}

/** Tank pool for a shared creature: join order, then id (tick-rng's contract). */
export function orderTankPool(
  rows: readonly ParticipantSnapshot[],
): ParticipantSnapshot[] {
  return orderParticipants(rows);
}

/** Generic id sort for output arrays. */
export function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort(byId);
}

/** Sort output records by one id field, then a second. */
export function sortBy<T>(
  rows: readonly T[],
  first: (row: T) => string,
  second?: (row: T) => string,
): T[] {
  return [...rows].sort(
    (a, b) => byId(first(a), first(b)) || (second ? byId(second(a), second(b)) : 0),
  );
}
