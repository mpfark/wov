/**
 * Effective combat modifiers use **soft scaling**, not hard caps.
 *
 * High stats always continue to provide value, but each additional point past
 * the profile's `softCap` is worth less than the previous one (`postCapRate`).
 * This reduces runaway linear scaling while keeping gear and stat investment
 * meaningful — there is no invisible wall.
 *
 * Negative or zero modifiers pass through unchanged so debuffed or low-stat
 * characters still suffer normally.
 *
 * Profiles are named so ability authors stay declarative; one tuning knob
 * moves every caller of that profile.
 *
 * NOTE: This file is mirrored in `supabase/functions/_shared/formulas/effective.ts`.
 * Keep both copies byte-for-byte equivalent (modulo `.ts` import suffixes).
 */

export type EffectiveProfile =
  | 'damage'   // T0 direct hits, Eviscerate base, Holy Shield retaliation
  | 'burst'    // big-cooldown nukes: Grand Finale, Conflagrate base
  | 'dot'      // per-tick DoT magnitudes: Rend, Ignite burn, poison
  | 'utility'  // armor reduction, root strength, debuff magnitudes (Sunder)
  | 'stacking'; // per-stack riders (Eviscerate per-stack, Envenom per-stack)

export interface EffectiveCurve {
  /** Modifiers at or below this value are returned 1:1. */
  softCap: number;
  /** Marginal value per point above `softCap` (0..1). Reduced marginal gain. */
  postCapRate: number;
}

export const PROFILES: Record<EffectiveProfile, EffectiveCurve> = {
  damage:   { softCap: 20, postCapRate: 0.45 },
  burst:    { softCap: 18, postCapRate: 0.40 },
  dot:      { softCap: 20, postCapRate: 0.50 },
  utility:  { softCap: 12, postCapRate: 0.30 },
  stacking: { softCap: 10, postCapRate: 0.25 },
};

/**
 * Apply soft scaling to a stat modifier for a given combat profile.
 *
 * - `mod <= 0` → pass-through (negatives still hurt).
 * - `mod <= softCap` → full value.
 * - `mod >  softCap` → `softCap + (mod - softCap) * postCapRate` (no clamp).
 */
export function getEffectiveCombatMod(mod: number, profile: EffectiveProfile): number {
  if (mod <= 0) return mod;
  const { softCap, postCapRate } = PROFILES[profile];
  if (mod <= softCap) return mod;
  return softCap + (mod - softCap) * postCapRate;
}
