/**
 * combat.ts — Combat math: AC, hit/crit/anti-crit, shield block, creature damage.
 *
 * CANONICAL OWNER for: calculateAC, getEffectiveAC, getInt/Dex/Wis/Str cross-stat
 * bonuses, shield block, creature damage die, level-gap multiplier, hit quality,
 * attack resolution, offensive/defensive buff application.
 *
 * Pure TS, zero deps. Mirrored byte-for-byte to
 * `supabase/functions/_shared/formulas/combat.ts`.
 *
 * ── CANONICAL DAMAGE PIPELINE (creature → player) ──────────────
 *   base damage
 *   → hit quality multiplier
 *   → crit multiplier (with WIS anti-crit check beforehand)
 *   → level gap adjustments
 *   → shield block (flat reduction, if triggered)
 *   → absorb effects (if any)
 *   → Battle Cry damage reduction
 *   → caps / clamps
 *   → finalAppliedDamage
 */

import { getStatModifier, rollD20, rollDamage, diminishing, diminishingFloat } from './stats';
import {
  CLASS_BASE_AC, CLASS_COMBAT_PROFILES, getWeaponAffinityBonus,
} from './classes';

// ── Cross-stat bonuses ───────────────────────────────────────────

/** INT → Hit Bonus: sqrt curve, capped at +5 */
export function getIntHitBonus(int: number): number {
  return diminishing(getStatModifier(int), 5);
}

/** DEX → Critical Hit Range reduction: sqrt curve, capped at +4 (16-20 max) */
export function getDexCritBonus(dex: number): number {
  return diminishing(getStatModifier(dex), 4);
}

/**
 * WIS → Anti-Crit: chance to downgrade an incoming crit to a normal hit.
 * sqrt curve, capped at 15%. Shield adds +5% separately.
 */
export function getWisAntiCrit(wis: number): number {
  return diminishingFloat(getStatModifier(wis), 0.03, 0.15);
}

/** STR → Minimum damage floor: sqrt curve, capped at +3 */
export function getStrDamageFloor(str: number): number {
  return diminishing(getStatModifier(str), 3);
}

// ── AC ───────────────────────────────────────────────────────────

/** AC = base class AC + DEX modifier */
export function calculateAC(charClass: string, dex: number): number {
  const baseAC = CLASS_BASE_AC[charClass] || 10;
  return baseAC + getStatModifier(dex);
}

/** Effective AC with gear bonuses and optional shield. */
export function getEffectiveAC(
  charClass: string,
  baseDex: number,
  equipmentBonuses: Record<string, number>,
  hasShield: boolean,
): number {
  const effectiveDex = baseDex + (equipmentBonuses.dex || 0);
  return calculateAC(charClass, effectiveDex) + (equipmentBonuses.ac || 0) + (hasShield ? 1 : 0);
}

// ── Shield block ─────────────────────────────────────────────────

export function getShieldBlockChance(dex: number): number {
  const mod = Math.max(getStatModifier(dex), 0);
  return 0.05 + Math.sqrt(mod) * 0.045;
}

export function getShieldBlockAmount(str: number): number {
  const mod = Math.max(getStatModifier(str), 0);
  return Math.round(11 + 2.5 * Math.sqrt(mod));
}

export function rollBlock(dex: number, str: number): { blocked: boolean; amount: number } {
  const chance = getShieldBlockChance(dex);
  const blocked = Math.random() < chance;
  return { blocked, amount: blocked ? getShieldBlockAmount(str) : 0 };
}

// ── Creature damage ──────────────────────────────────────────────

const CREATURE_DAMAGE_BASE: Record<string, number> = {
  regular: 4, rare: 6, boss: 10,
};

export function getCreatureDamageDie(level: number, rarity: string): number {
  const base = CREATURE_DAMAGE_BASE[rarity] || 4;
  return base + Math.floor(level * 0.7);
}

/** Bonus damage multiplier when creature out-levels the player (+8% per level diff) */
export function getCreatureLevelGapMultiplier(creatureLevel: number, playerLevel: number): number {
  const diff = Math.max(creatureLevel - playerLevel, 0);
  return 1 + diff * 0.08;
}

/** Level-based creature attack bonus to scale hit rates */
export function getCreatureAttackBonus(level: number): number {
  return Math.floor(level * 0.4);
}

/** Resolve creature counterattack damage (before defensive buffs) */
export function rollCreatureDamage(
  creatureLevel: number,
  creatureRarity: string,
  creatureStr: number,
  playerLevel?: number,
): number {
  const dmgDie = getCreatureDamageDie(creatureLevel, creatureRarity);
  const baseDmg = Math.max(rollDamage(1, dmgDie) + getStatModifier(creatureStr), 1);
  if (playerLevel != null) {
    return Math.max(Math.floor(baseDmg * getCreatureLevelGapMultiplier(creatureLevel, playerLevel)), 1);
  }
  return baseDmg;
}

// ── Hit quality (graded hit system) ─────────────────────────────

export type HitQuality = 'miss' | 'glancing' | 'weak' | 'normal' | 'strong';

/**
 * Determine hit quality based on attack margin (totalAtk - defenderAC).
 * Natural 1 always misses. Crits get at least 'normal' quality.
 */
export function getHitQuality(margin: number, isNat1: boolean, isCrit: boolean): HitQuality {
  if (isNat1) return 'miss';
  if (isCrit) return margin >= 7 ? 'strong' : 'normal';
  if (margin < -5) return 'miss';
  if (margin < 0) return 'glancing';
  if (margin <= 2) return 'weak';
  if (margin <= 6) return 'normal';
  return 'strong';
}

export const HIT_QUALITY_MULT: Record<HitQuality, number> = {
  miss: 0, glancing: 0.25, weak: 0.60, normal: 1.0, strong: 1.25,
};

/** Hard cap for glancing hits; also applies to weak hits when margin < -2 */
export const GLANCING_WEAK_CAP = 3;

// ── Attack resolution helpers ────────────────────────────────────

export interface AttackContext {
  attackerStat: number;     // effective stat value (base + equipment)
  int: number;              // effective INT (base + equipment)
  dex: number;              // effective DEX (base + equipment)
  str: number;              // effective STR (base + equipment)
  level: number;
  classKey: string;
  /** Extra crit range bonus from buffs (Eagle Eye) */
  critBuffBonus?: number;
  /** Weapon tag of main-hand weapon for affinity bonuses */
  weaponTag?: string | null;
}

export interface AttackResult {
  hit: boolean;
  isCrit: boolean;
  roll: number;
  totalAtk: number;
  effectiveCreatureAC: number;
  baseDamage: number;       // before buff multipliers
  intHitBonus: number;
  strFloor: number;
}

/**
 * Resolve a single attack roll against a creature.
 * Returns whether it hit, crit, and the base damage (before stealth/surge/etc multipliers).
 */
export function resolveAttackRoll(
  ctx: AttackContext,
  creatureAC: number,
  sunderReduction: number = 0,
): AttackResult {
  const profile = CLASS_COMBAT_PROFILES[ctx.classKey] || CLASS_COMBAT_PROFILES.warrior;
  const sMod = getStatModifier(ctx.attackerStat);
  const ihb = getIntHitBonus(ctx.int);
  const dcb = getDexCritBonus(ctx.dex);
  const mileCrit = ctx.level >= 28 ? 1 : 0;
  const effCrit = profile.critRange - dcb - mileCrit - (ctx.critBuffBonus || 0);
  const sdf = getStrDamageFloor(ctx.str);
  const affinity = getWeaponAffinityBonus(ctx.classKey, ctx.weaponTag);

  const roll = rollD20();
  const totalAtk = roll + sMod + ihb + affinity.hitBonus;
  const effectiveAC = Math.max(creatureAC - sunderReduction, 0);

  const hit = roll >= effCrit || (roll !== 1 && totalAtk >= effectiveAC);
  const isCrit = roll >= effCrit;

  let baseDamage = 0;
  if (hit) {
    const rawDmg = rollDamage(profile.diceMin, profile.diceMax) + sMod;
    const preBuff = isCrit ? Math.max(Math.floor(rawDmg * 1.5), 1) : Math.max(rawDmg, 1 + sdf);
    baseDamage = Math.max(Math.floor(preBuff * affinity.damageMult), 1);
  }

  return { hit, isCrit, roll, totalAtk, effectiveCreatureAC: effectiveAC, baseDamage, intHitBonus: ihb, strFloor: sdf };
}

/**
 * Apply offensive buff multipliers to base damage.
 */
export function applyOffensiveBuffs(
  baseDamage: number,
  opts: {
    isStealth?: boolean;
    isDamageBuff?: boolean;
    focusStrikeDmg?: number;
    disengageMult?: number;
  },
): { finalDamage: number; consumed: string[] } {
  let dmg = baseDamage;
  const consumed: string[] = [];

  if (opts.isStealth) { dmg *= 2; consumed.push('stealth'); }
  if (opts.isDamageBuff) { dmg = Math.floor(dmg * 1.5); }
  if (opts.focusStrikeDmg) { dmg += opts.focusStrikeDmg; consumed.push('focus_strike'); }
  if (opts.disengageMult) { dmg = Math.floor(dmg * (1 + opts.disengageMult)); consumed.push('disengage'); }

  return { finalDamage: Math.max(dmg, 1), consumed };
}

/**
 * Apply defensive modifiers to incoming damage.
 *
 *   → root DR → shield block (flat) → absorb shield → clamp
 */
export function applyDefensiveBuffs(
  damage: number,
  opts: {
    isRooted?: boolean;
    blockAmount?: number;
    absorbShieldHp?: number;
  },
): { finalDamage: number; absorbed: number; remainingShield: number; blocked: number } {
  let dmg = damage;

  if (opts.isRooted) {
    dmg = Math.max(Math.floor(dmg * 0.7), 1);
  }

  let blocked = 0;
  if (opts.blockAmount && opts.blockAmount > 0) {
    blocked = Math.min(dmg, opts.blockAmount);
    dmg -= blocked;
  }

  let absorbed = 0;
  let remainingShield = opts.absorbShieldHp ?? 0;
  if (remainingShield > 0) {
    absorbed = Math.min(dmg, remainingShield);
    remainingShield -= absorbed;
    dmg -= absorbed;
  }

  return { finalDamage: Math.max(dmg, 0), absorbed, remainingShield, blocked };
}
