/**
 * combat2/boss-catalog.ts — typed adapter from the game's REAL authored boss
 * telegraph configuration (`creatures.boss_cast`) to `SnapshotBossAbility`.
 *
 * Two facts drive the design, both established by reading the installed data:
 *   - `public.boss_ability` is EMPTY in production; every authored boss cast
 *     lives in the `creatures.boss_cast` JSON document;
 *   - `boss_cast` is millisecond-based (`cast_ms`, `cooldown_ms`, `chance`) and
 *     carries a stored-power accumulation model plus split primary/AoE shares.
 *     The replacement contract is tick-based and single-target-mode.
 *
 * Only unambiguous fields are translated. Anything that would require inventing
 * semantics (stored-power accumulation, a simultaneous primary + AoE split, a
 * missing stable `ability_key`) is REJECTED with a reason so the gap is visible
 * instead of silently mis-simulated.
 */

import type { NodeSnapshot, SnapshotBossAbility, SnapshotBossConfiguration } from './types.ts';

/** The authored document as stored on `creatures.boss_cast`. */
export interface AuthoredBossCast {
  enabled?: boolean;
  ability_key?: string | null;
  label?: string | null;
  cast_ms?: number | null;
  lock_ms?: number | null;
  cooldown_ms?: number | null;
  chance?: number | null;
  damage_type?: string | null;
  amount?: number | null;
  base_amount?: number | null;
  base_aoe_amount?: number | null;
  target_mode?: string | null;
  cast_flavor?: string | null;
  hit_flavor?: string | null;
  accumulate?: { enabled?: boolean } | null;
  stored_power?: Record<string, unknown> | null;
}

export interface BossCastRejection {
  creatureId: string;
  label: string | null;
  reason:
    | 'disabled'
    | 'missing_ability_key'
    | 'missing_cast_ms'
    | 'missing_amount'
    | 'unsupported_target_mode'
    | 'stored_power_unsupported'
    | 'split_target_shares_unsupported';
}

export interface BossCatalog {
  abilities: SnapshotBossAbility[];
  rejected: BossCastRejection[];
}

/** The authoritative cadence: one tick every two seconds. */
export const TICK_MS = 2000;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Adapt one creature's authored cast. */
export function adaptBossCast(
  creatureId: string,
  cast: AuthoredBossCast | null | undefined,
): { ability: SnapshotBossAbility } | { rejection: BossCastRejection } {
  const label = cast?.label ?? null;
  const reject = (reason: BossCastRejection['reason']): { rejection: BossCastRejection } => ({
    rejection: { creatureId, label, reason },
  });

  if (!cast || cast.enabled === false) return reject('disabled');
  if (!cast.ability_key) return reject('missing_ability_key');

  const castMs = num(cast.cast_ms);
  if (castMs === null || castMs <= 0) return reject('missing_cast_ms');

  const amount = num(cast.base_amount) ?? num(cast.amount);
  if (amount === null || amount <= 0) return reject('missing_amount');

  if (cast.target_mode != null && !['tank', 'aoe', 'random'].includes(cast.target_mode)) {
    return reject('unsupported_target_mode');
  }

  // Stored power turns the telegraph's magnitude into an accumulated pool. The
  // replacement contract has no field for it; adapting it would change balance.
  if (cast.accumulate?.enabled === true || (cast.stored_power && Object.keys(cast.stored_power).length > 0)) {
    return reject('stored_power_unsupported');
  }

  // A cast that hits the primary target AND everyone else for a different amount
  // is two effects; `targeting` can only express one.
  const aoeAmount = num(cast.base_aoe_amount) ?? 0;
  if (aoeAmount > 0) return reject('split_target_shares_unsupported');

  const targeting: SnapshotBossAbility['targeting'] =
    cast.target_mode === 'aoe' ? 'aoe' : cast.target_mode === 'random' ? 'random' : 'tank';

  return {
    ability: {
      id: `${creatureId}:${cast.ability_key}`,
      creature_id: creatureId,
      ability_key: cast.ability_key,
      label,
      // `chance` is the authored per-opportunity probability; it is the only
      // authored selection weight there is.
      weight: num(cast.chance) ?? 0,
      windup_ticks: Math.max(1, Math.ceil(castMs / TICK_MS)),
      targeting,
      magnitude: Math.floor(amount),
      amount_calc: null,
      damage_type: cast.damage_type ?? null,
      effect: null,
      telegraph_text: cast.cast_flavor ?? null,
      resolution_text: cast.hit_flavor ?? null,
    },
  };
}

/** Adapt every authored boss cast, reporting every gap. */
export function buildBossCatalog(
  rows: ReadonlyArray<{ id: string; boss_cast: AuthoredBossCast | null }>,
): BossCatalog {
  const abilities: SnapshotBossAbility[] = [];
  const rejected: BossCastRejection[] = [];
  for (const row of rows) {
    const result = adaptBossCast(row.id, row.boss_cast);
    if ('rejection' in result) rejected.push(result.rejection);
    else abilities.push(result.ability);
  }
  return { abilities, rejected };
}

/** Adapt only the authored rows captured and identity-bound by the claim. */
export function adaptClaimedBossCatalog(
  snapshot: NodeSnapshot,
): { snapshot: NodeSnapshot; rejected: BossCastRejection[] } {
  const configs: readonly SnapshotBossConfiguration[] = snapshot.boss_configurations ?? [];
  const abilities: SnapshotBossAbility[] = [];
  const rejected: BossCastRejection[] = [];
  for (const config of configs) {
    const result = adaptBossCast(config.creature_id, config.boss_cast);
    if ('rejection' in result) rejected.push(result.rejection);
    else abilities.push({ ...result.ability, spawn_seq: config.spawn_seq });
  }
  return {
    snapshot: { ...snapshot, boss_abilities: abilities },
    rejected: rejected.filter((row) => row.reason !== 'disabled'),
  };
}
