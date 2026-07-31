/**
 * Phase 5b — shared damage / heal resolution primitives.
 *
 * Pure, allocation-cheap math shared by the client and the edge functions
 * (mirrored to `supabase/functions/_shared/combat/resolution.ts`).
 *
 * These primitives own only the LAST step of the damage pipeline: turning an
 * already-mitigated amount into an HP/ward delta. Rolls, mitigation, crit
 * bands, bond scalars and so on stay where they are — see
 * `mem://tech/combat-architecture/damage-pipeline`.
 *
 * Invariants they guarantee for every caller:
 *   - HP never goes below 0 and never above maxHp.
 *   - `applied` is the real delta (what the log should print), never the raw
 *     request, so overheal and ward absorption can't be double-counted.
 *   - Non-finite / negative inputs are clamped rather than propagated as NaN.
 */

const clampNonNegative = (n: number): number =>
  Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

export interface DamageResolution {
  /** Requested damage after clamping. */
  raw: number;
  /** Portion soaked by a ward / shield pool. */
  absorbed: number;
  /** Portion actually removed from HP (what the log prints). */
  applied: number;
  hpBefore: number;
  hpAfter: number;
  shieldBefore: number;
  shieldAfter: number;
  /** True when this hit brought a living target to 0 HP. */
  killed: boolean;
}

/** Resolve an already-mitigated damage amount against HP and an optional ward. */
export function resolveDamage(input: {
  amount: number;
  hp: number;
  /** Absorb pool (Force Shield, Divine Aegis...). Omit when there is none. */
  shield?: number;
}): DamageResolution {
  const raw = clampNonNegative(input.amount);
  const hpBefore = Math.max(0, Math.floor(Number.isFinite(input.hp) ? input.hp : 0));
  const shieldBefore = clampNonNegative(input.shield ?? 0);

  const absorbed = Math.min(shieldBefore, raw);
  const applied = Math.min(hpBefore, raw - absorbed);
  const hpAfter = hpBefore - applied;

  return {
    raw,
    absorbed,
    applied,
    hpBefore,
    hpAfter,
    shieldBefore,
    shieldAfter: shieldBefore - absorbed,
    killed: hpBefore > 0 && hpAfter === 0,
  };
}

export interface HealResolution {
  /** Requested healing after clamping. */
  raw: number;
  /** Portion actually restored (what the log prints). */
  applied: number;
  overheal: number;
  hpBefore: number;
  hpAfter: number;
}

/**
 * Resolve healing against HP and a cap. Dead targets (0 HP) are NOT revived —
 * healing the fallen is a separate mechanic, never an incidental side effect.
 */
export function resolveHeal(input: { amount: number; hp: number; maxHp: number }): HealResolution {
  const raw = clampNonNegative(input.amount);
  const hpBefore = Math.max(0, Math.floor(Number.isFinite(input.hp) ? input.hp : 0));
  const maxHp = Math.max(1, Math.floor(Number.isFinite(input.maxHp) ? input.maxHp : 1));

  if (hpBefore <= 0) {
    return { raw, applied: 0, overheal: raw, hpBefore, hpAfter: hpBefore };
  }

  const hpAfter = Math.min(maxHp, hpBefore + raw);
  const applied = hpAfter - hpBefore;
  return { raw, applied, overheal: raw - applied, hpBefore, hpAfter };
}
