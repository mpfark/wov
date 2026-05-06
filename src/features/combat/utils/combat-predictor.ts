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
  getStatModifier,
  getIntHitBonus,
  getWeaponAffinityBonus,
  getWeaponDieForItem,
} from './combat-math';

export interface PredictionContext {
  classKey: string;
  /** Effective DEX (drives autoattack to-hit roll). */
  attackerStat: number;
  int: number;
  /** Effective STR (drives autoattack damage). */
  str: number;
  creatureAC: number;
  sunderReduction?: number;
  weaponTag?: string | null;
  /** Hands the main-hand weapon is wielded with (1 or 2). Defaults to 1. */
  weaponHands?: 1 | 2;
  /** Item level of main-hand weapon (drives die-size progression). */
  weaponItemLevel?: number | null;
}

export interface PredictionResult {
  predictedDamage: number;
  shouldPredict: boolean;
}

/**
 * Estimate average damage conservatively (weapon-die based).
 *
 *   To-hit:  d20 + DEX mod + INT hit bonus + weapon affinity
 *   Damage:  avg(1d{die}) + STR mod (× affinity)
 *
 * Returns { shouldPredict: false } if hit chance is too uncertain.
 */
export function predictConservativeDamage(ctx: PredictionContext): PredictionResult {
  const dexHitMod = getStatModifier(ctx.attackerStat); // attackerStat = DEX
  const strDmgMod = getStatModifier(ctx.str);
  const ihb = getIntHitBonus(ctx.int);
  const affinity = getWeaponAffinityBonus(ctx.classKey, ctx.weaponTag);
  const effectiveAC = Math.max(ctx.creatureAC - (ctx.sunderReduction || 0), 0);
  const hands: 1 | 2 = ctx.weaponHands === 2 ? 2 : 1;
  const die = getWeaponDieForItem(ctx.weaponTag, hands, ctx.weaponItemLevel);

  // Estimate hit chance: need roll + dexHitMod + ihb + affinity >= effectiveAC
  const threshold = Math.max(effectiveAC - dexHitMod - ihb - affinity.hitBonus, 1);
  const hitChance = Math.min((21 - threshold) / 20, 1);

  if (hitChance < 0.70) {
    return { predictedDamage: 0, shouldPredict: false };
  }

  // Average roll on 1d{die} is (1 + die) / 2
  const avgRoll = Math.floor((1 + die) / 2);
  const rawDmg = Math.max(avgRoll + strDmgMod, 1);
  const finalDmg = Math.max(Math.floor(rawDmg * affinity.damageMult), 1);

  return { predictedDamage: finalDmg, shouldPredict: true };
}

/**
 * Apply predicted damage to creature HP. Never drops below 1.
 */
export function applyPredictedDamage(currentHp: number, predictedDamage: number): number {
  return Math.max(currentHp - predictedDamage, 1);
}

/**
 * Remove prediction overrides for creatures that now have authoritative server data.
 * Pure helper — returns a new object or the same reference if nothing changed.
 */
export function clearPredictionForCreatures(
  prev: Record<string, { hp: number; ts: number }>,
  serverCreatureIds: Set<string>,
): Record<string, { hp: number; ts: number }> {
  const keys = Object.keys(prev);
  const toRemove = keys.filter(k => serverCreatureIds.has(k));
  if (toRemove.length === 0) return prev;
  const next = { ...prev };
  toRemove.forEach(k => delete next[k]);
  return next;
}
