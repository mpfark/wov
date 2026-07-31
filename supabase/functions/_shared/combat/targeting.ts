/**
 * Phase 5b — shared targeting primitives.
 *
 * One place that answers "who does this hit?" so boss autoattacks,
 * telegraphed casts and stored-power bookkeeping can't drift apart.
 * Mirrored to `supabase/functions/_shared/combat/targeting.ts`.
 *
 * Threat model note: the game has no threat/taunt accumulation. A party's
 * designated tank (`parties.tank_id`, falling back to the leader) simply
 * absorbs everything while alive — that is what `tank_strict` encodes.
 */

export interface TargetCandidate {
  id: string;
  hp: number;
}

export type TargetMode =
  /** Tank soaks it. If the tank is missing or down, nobody is hit this beat. */
  | 'tank_strict'
  /** Tank soaks it, but fall back to any living candidate. */
  | 'tank_preferred'
  /** Uniformly random living candidate. */
  | 'random_alive';

/** Living candidates, order preserved. */
export function livingTargets<T extends TargetCandidate>(candidates: readonly T[]): T[] {
  return candidates.filter(c => Number.isFinite(c.hp) && c.hp > 0);
}

/**
 * Pick the single target for an attack or cast.
 *
 * `pick` is injectable so tests are deterministic; it must return a float in
 * [0, 1) like `Math.random`.
 */
export function selectPrimaryTarget<T extends TargetCandidate>(
  candidates: readonly T[],
  opts: { mode: TargetMode; tankId?: string | null; pick?: () => number },
): T | null {
  const alive = livingTargets(candidates);
  if (alive.length === 0) return null;

  const tank = opts.tankId ? alive.find(c => c.id === opts.tankId) ?? null : null;

  switch (opts.mode) {
    case 'tank_strict':
      return tank;
    case 'tank_preferred':
      return tank ?? alive[0];
    case 'random_alive': {
      const roll = opts.pick ? opts.pick() : Math.random();
      const idx = Math.min(alive.length - 1, Math.max(0, Math.floor(roll * alive.length)));
      return alive[idx];
    }
  }
}

/** Every living candidate — the target set for AoE pulses and node-wide casts. */
export function selectAoeTargets<T extends TargetCandidate>(
  candidates: readonly T[],
  opts: { excludeId?: string | null } = {},
): T[] {
  return livingTargets(candidates).filter(c => c.id !== opts.excludeId);
}
