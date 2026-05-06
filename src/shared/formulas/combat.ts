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
  CLASS_BASE_AC, getWeaponAffinityBonus, getClassCritRange,
} from './classes';

// ── Weapon-based autoattack dice ─────────────────────────────────
//
// Basic autoattacks are weapon-based. The weapon's die + STR modifier is
// the entire damage formula — class no longer determines dice. The two-
// handed benefit lives entirely in the larger die (no separate multiplier).
//
// Tuning dial: if 2H weapons feel weak in playtest, bump the `twoHand`
// values here rather than re-introducing a damage multiplier.
export const WEAPON_DAMAGE_DIE: Record<string, { oneHand?: number; twoHand?: number }> = {
  dagger: { oneHand: 4 },
  wand:   { oneHand: 4 },
  sword:  { oneHand: 6, twoHand: 10 },
  axe:    { oneHand: 6, twoHand: 10 },
  mace:   { oneHand: 6, twoHand: 10 },
  staff:  { oneHand: 6, twoHand: 8  },
  bow:    {              twoHand: 8  },
};

/** Damage die used when no weapon is equipped (unarmed strike). */
export const UNARMED_DIE = 3;

// ── Arcane Surge (wizard damage_buff) ────────────────────────────
//
// Multiplier applied to all damage dealt by a member with the
// `damage_buff` active effect (Arcane Surge). Centralized so tooltips,
// combat-log text and the server pipeline stay in sync. Tuning dial.
export const ARCANE_SURGE_DAMAGE_MULT = 1.15;
/** Pretty +X% string for tooltips/UI. */
export const ARCANE_SURGE_DAMAGE_BONUS_PCT = Math.round((ARCANE_SURGE_DAMAGE_MULT - 1) * 100);

/**
 * Resolve the autoattack damage die for a weapon at a given hand count.
 * Falls back to UNARMED_DIE when the weapon tag is missing or unknown.
 * If a weapon's hand-variant is missing (e.g. 2H value missing), falls
 * back to the other hand value rather than unarmed.
 */
export function getWeaponDie(weaponTag: string | null | undefined, hands: 1 | 2): number {
  if (!weaponTag) return UNARMED_DIE;
  const entry = WEAPON_DAMAGE_DIE[weaponTag];
  if (!entry) return UNARMED_DIE;
  if (hands === 2) return entry.twoHand ?? entry.oneHand ?? UNARMED_DIE;
  return entry.oneHand ?? entry.twoHand ?? UNARMED_DIE;
}

/**
 * Item-level weapon die progression.
 *
 *   1–10  → +0
 *   11–20 → +1
 *   21–30 → +2
 *   31+   → +3
 *
 * Soft, additive scaling that preserves family identity (dagger stays
 * lighter than a sword) while making higher-level weapons noticeably
 * stronger. Tuning dial.
 */
export function getWeaponDieProgression(itemLevel: number | null | undefined): number {
  const lvl = itemLevel ?? 1;
  if (lvl <= 10) return 0;
  if (lvl <= 20) return 1;
  if (lvl <= 30) return 2;
  return 3;
}

/**
 * Resolve the autoattack damage die for a weapon, applying item-level
 * progression on top of the family base die. Unarmed (no tag) ignores
 * progression because there is no item.
 */
export function getWeaponDieForItem(
  weaponTag: string | null | undefined,
  hands: 1 | 2,
  itemLevel: number | null | undefined,
): number {
  const base = getWeaponDie(weaponTag, hands);
  if (!weaponTag) return base;
  return base + getWeaponDieProgression(itemLevel);
}

/** Roll one weapon attack: 1d{weaponDie} + STR modifier. */
export function rollWeaponAttackDamage(
  weaponTag: string | null | undefined,
  hands: 1 | 2,
  str: number,
  itemLevel?: number | null,
): number {
  const die = getWeaponDieForItem(weaponTag, hands, itemLevel);
  return rollDamage(1, die) + getStatModifier(str);
}

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
  /**
   * Effective DEX (base + equipment) — drives the autoattack to-hit roll.
   * (Renamed from STR: hit is now DEX-based for both melee and ranged.
   * Damage continues to scale from STR via the `str` field.)
   */
  attackerStat: number;
  int: number;              // effective INT (base + equipment) — secondary hit bonus
  dex: number;              // effective DEX (base + equipment) — also crit-range reduction
  str: number;              // effective STR (base + equipment) — damage scaling + damage floor
  level: number;
  classKey: string;         // crit threshold + weapon affinity only
  /** Extra crit range bonus from buffs (Eagle Eye) */
  critBuffBonus?: number;
  /** Weapon tag of main-hand weapon for affinity bonuses + die selection */
  weaponTag?: string | null;
  /** Hands the main-hand weapon is wielded with (1 or 2). Defaults to 1. */
  weaponHands?: 1 | 2;
  /** Item level of main-hand weapon (drives die-size progression). */
  weaponItemLevel?: number | null;
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
 * Resolve a single autoattack roll against a creature.
 *
 *   To-hit:  d20 + DEX mod + INT hit bonus + weapon affinity bonus
 *   Damage:  1d{weaponDie} + STR mod        (STR damage floor on non-crits)
 *
 * Class only influences:
 *   - crit threshold (rogue 19 vs 20 for everyone else)
 *   - weapon affinity (matching class+weapon = +1 hit, x1.10 damage)
 */
export function resolveAttackRoll(
  ctx: AttackContext,
  creatureAC: number,
  sunderReduction: number = 0,
): AttackResult {
  const dexHitMod = getStatModifier(ctx.attackerStat); // attackerStat now = DEX
  const strDmgMod = getStatModifier(ctx.str);
  const ihb = getIntHitBonus(ctx.int);
  const dcb = getDexCritBonus(ctx.dex);
  const mileCrit = ctx.level >= 28 ? 1 : 0;
  const baseCrit = getClassCritRange(ctx.classKey);
  const effCrit = baseCrit - dcb - mileCrit - (ctx.critBuffBonus || 0);
  const sdf = getStrDamageFloor(ctx.str);
  const affinity = getWeaponAffinityBonus(ctx.classKey, ctx.weaponTag);
  const hands: 1 | 2 = ctx.weaponHands === 2 ? 2 : 1;
  const die = getWeaponDie(ctx.weaponTag, hands);

  const roll = rollD20();
  const totalAtk = roll + dexHitMod + ihb + affinity.hitBonus;
  const effectiveAC = Math.max(creatureAC - sunderReduction, 0);

  const hit = roll >= effCrit || (roll !== 1 && totalAtk >= effectiveAC);
  const isCrit = roll >= effCrit;

  let baseDamage = 0;
  if (hit) {
    const rawDmg = rollDamage(1, die) + strDmgMod;
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
    disengageMult?: number;
  },
): { finalDamage: number; consumed: string[] } {
  let dmg = baseDamage;
  const consumed: string[] = [];

  if (opts.isStealth) { dmg *= 2; consumed.push('stealth'); }
  if (opts.isDamageBuff) { dmg = Math.floor(dmg * 1.5); }
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
