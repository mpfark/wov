/**
 * combat-predictor.ts — Conservative client-side damage prediction.
 *
 * Used for optimistic HP bar updates while waiting for the server tick response.
 * Design rules:
 * - Uses expected average damage (no random rolls, no crits)
 * - Skips prediction if hit chance < 70%
 * - Never predicts creature death (minimum 1 HP)
 * - Never predicts crits
 */

import {
  CLASS_COMBAT_PROFILES,
  getStatModifier,
  getIntHitBonus,
  getWeaponAffinityBonus,
} from './combat-math';

export interface PredictionContext {
  classKey: string;
  attackerStat: number;
  int: number;
  str: number;
  creatureAC: number;
  sunderReduction?: number;
  weaponTag?: string | null;
}

export interface PredictionResult {
  predictedDamage: number;
  shouldPredict: boolean;
}

/**
 * Estimate average damage conservatively.
 * Returns { shouldPredict: false } if hit chance is too uncertain.
 */
export function predictConservativeDamage(ctx: PredictionContext): PredictionResult {
  const profile = CLASS_COMBAT_PROFILES[ctx.classKey] || CLASS_COMBAT_PROFILES.warrior;
  const sMod = getStatModifier(ctx.attackerStat);
  const ihb = getIntHitBonus(ctx.int);
  const affinity = getWeaponAffinityBonus(ctx.classKey, ctx.weaponTag);
  const effectiveAC = Math.max(ctx.creatureAC - (ctx.sunderReduction || 0), 0);

  // Estimate hit chance: need roll + sMod + ihb + affinity >= effectiveAC
  // On a d20 (1-20), P(roll >= threshold) = (21 - threshold) / 20
  const threshold = Math.max(effectiveAC - sMod - ihb - affinity.hitBonus, 1);
  const hitChance = Math.min((21 - threshold) / 20, 1);

  if (hitChance < 0.70) {
    return { predictedDamage: 0, shouldPredict: false };
  }

  // Average damage: floor((min + max) / 2) + stat mod, no crits
  const avgRoll = Math.floor((profile.diceMin + profile.diceMax) / 2);
  const rawDmg = Math.max(avgRoll + sMod, 1);
  const finalDmg = Math.max(Math.floor(rawDmg * affinity.damageMult), 1);

  return { predictedDamage: finalDmg, shouldPredict: true };
}

/**
 * Apply predicted damage to creature HP. Never drops below 1.
 */
export function applyPredictedDamage(currentHp: number, predictedDamage: number): number {
  return Math.max(currentHp - predictedDamage, 1);
}
