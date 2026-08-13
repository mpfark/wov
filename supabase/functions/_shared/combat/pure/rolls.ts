/**
 * pure/rolls.ts — seeded equivalents of the legacy roll helpers.
 *
 * The *math* is unchanged: every formula below delegates to the canonical
 * owners in `src/shared/formulas`. Only the source of randomness moves, from
 * `Math.random()` to a named RNG stream. Legacy helpers that bundle a roll
 * with their math (`resolveAttackRoll`, `rollBlock`, `rollCreatureDamage`,
 * `rollWeaponAttackDamage`, `rollD20`, `rollDamage`) are re-expressed here;
 * the pure resolver imports these and never the roll-bearing originals.
 */

import {
  getStatModifier,
  diminishing,
} from '../../formulas/stats.ts';
import {
  getIntHitBonus,
  getDexCritBonus,
  getStrDamageFloor,
  getWeaponDieForItem,
  getShieldBlockChance,
  getShieldBlockAmount,
  getShieldWallChanceBonus,
  getShieldWallAmountBonus,
  getCreatureDamageDie,
  getCreatureLevelGapMultiplier,
  getCreatureAttackBonus,
  getWisAntiCrit,
  getHitQuality,
  HIT_QUALITY_MULT,
  CREATURE_CRIT_MULT,
  GLANCING_WEAK_CAP,
  type HitQuality,
  type WeaponProgressionConfig,
} from '../../formulas/combat.ts';
import { getClassCritRange, getWeaponAffinityBonus } from '../../formulas/classes.ts';
import type { RngStream, TickRandom } from './rng.ts';
import type { Attributes, ParticipantSnapshot } from './types.ts';

export interface SeededAttack {
  readonly hit: boolean;
  readonly isCrit: boolean;
  readonly roll: number;
  readonly totalAtk: number;
  readonly effectiveAC: number;
  readonly baseDamage: number;
}

/**
 * Player → creature autoattack, identical to `resolveAttackRoll` except the
 * d20 and the damage die come from seeded streams.
 */
export function seededAttackRoll(input: {
  rng: TickRandom;
  attacker: ParticipantSnapshot;
  creatureId: string;
  creatureAC: number;
  sunderReduction?: number;
  progression: WeaponProgressionConfig;
  /** Stream key suffix: which beat of the tick this is. */
  key: readonly (string | number)[];
  rollStream?: RngStream;
  damageStream?: RngStream;
}): SeededAttack {
  const { rng, attacker, creatureId, creatureAC, progression, key } = input;
  const attrs = attacker.attrs;
  const dexHitMod = getStatModifier(attrs.dex);
  const strDmgMod = getStatModifier(attrs.str);
  const ihb = getIntHitBonus(attrs.int);
  const dcb = getDexCritBonus(attrs.dex);
  const mileCrit = attacker.level >= 28 ? 1 : 0;
  const effCrit =
    getClassCritRange(attacker.classKey) - dcb - mileCrit - (attacker.buffs.critBuffBonus || 0);
  const sdf = getStrDamageFloor(attrs.str);
  const affinity = getWeaponAffinityBonus(attacker.classKey, attacker.weapon.tag);
  const die = getWeaponDieForItem(
    attacker.weapon.tag,
    attacker.weapon.hands,
    attacker.weapon.itemLevel,
    progression,
    attacker.weapon.rarity,
  );

  const roll = rng.roll(input.rollStream ?? 'attack_roll', 20, attacker.id, creatureId, ...key);
  const totalAtk = roll + dexHitMod + ihb + affinity.hitBonus;
  const effectiveAC = Math.max(creatureAC - (input.sunderReduction ?? 0), 0);

  const hit = roll >= effCrit || (roll !== 1 && totalAtk >= effectiveAC);
  const isCrit = roll >= effCrit;

  let baseDamage = 0;
  if (hit) {
    const dieRoll = rng.roll(
      input.damageStream ?? 'attack_damage',
      die,
      attacker.id,
      creatureId,
      ...key,
    );
    const rawDmg = dieRoll + strDmgMod;
    const preBuff = isCrit ? Math.max(Math.floor(rawDmg * 1.5), 1) : Math.max(rawDmg, 1 + sdf);
    baseDamage = Math.max(Math.floor(preBuff * affinity.damageMult), 1);
  }

  return { hit, isCrit, roll, totalAtk, effectiveAC, baseDamage };
}

/** Weapon-die contribution for a weapon-based ability, seeded. */
export function seededWeaponAbilityDamage(input: {
  rng: TickRandom;
  attacker: ParticipantSnapshot;
  progression: WeaponProgressionConfig;
  key: readonly (string | number)[];
}): number {
  const die = getWeaponDieForItem(
    input.attacker.weapon.tag,
    input.attacker.weapon.hands,
    input.attacker.weapon.itemLevel,
    input.progression,
    input.attacker.weapon.rarity,
  );
  const dieRoll = input.rng.roll('ability_damage', die, input.attacker.id, ...input.key);
  return dieRoll + getStatModifier(input.attacker.attrs.str);
}

export interface SeededBlock {
  readonly blocked: boolean;
  readonly amount: number;
  readonly chance: number;
}

/**
 * Shield block, seeded. Shield Wall (`block_buff`) is a CP-reserved stance, so
 * its bonuses are re-derived by the loader every tick from
 * `characters.reserved_buffs` and arrive as resolved numbers. When the loader
 * supplies no configured bonus we fall back to the legacy WIS/CON formulas, so
 * an unconfigured stance keeps its shipped strength.
 */
export function seededBlock(input: {
  rng: TickRandom;
  defender: ParticipantSnapshot;
  creatureId: string;
  key: readonly (string | number)[];
}): SeededBlock {
  const { rng, defender, creatureId, key } = input;
  if (!defender.hasShield) return { blocked: false, amount: 0, chance: 0 };
  const attrs = defender.attrs;
  const b = defender.buffs;
  let chance = getShieldBlockChance(attrs.dex);
  let amount = getShieldBlockAmount(attrs.str);
  let cap = 0.95;
  if (b.blockBuff) {
    chance +=
      typeof b.blockChanceBonus === 'number'
        ? b.blockChanceBonus
        : getShieldWallChanceBonus(attrs.wis);
    amount +=
      typeof b.blockAmountBonus === 'number'
        ? b.blockAmountBonus
        : getShieldWallAmountBonus(attrs.con);
    if (typeof b.blockChanceCap === 'number' && b.blockChanceCap > 0) cap = b.blockChanceCap;
  }
  chance = Math.min(cap, chance);
  const blocked = rng.sample('block', defender.id, creatureId, ...key) < chance;
  return { blocked, amount: blocked ? Math.round(amount) : 0, chance };
}

/** Creature → player damage roll, seeded (level-gap multiplier preserved). */
export function seededCreatureDamage(input: {
  rng: TickRandom;
  creatureId: string;
  creatureLevel: number;
  creatureRarity: string;
  creatureAttrs: Attributes;
  targetId: string;
  targetLevel: number;
  key: readonly (string | number)[];
}): number {
  const die = getCreatureDamageDie(input.creatureLevel, input.creatureRarity);
  const dieRoll = input.rng.roll(
    'creature_attack_damage',
    die,
    input.creatureId,
    input.targetId,
    ...input.key,
  );
  const base = Math.max(dieRoll + getStatModifier(input.creatureAttrs.str), 1);
  const gap = getCreatureLevelGapMultiplier(input.creatureLevel, input.targetLevel);
  return Math.max(Math.floor(base * gap), 1);
}

export interface SeededCreatureAttack {
  readonly roll: number;
  readonly totalAtk: number;
  readonly margin: number;
  readonly quality: HitQuality;
  readonly isCrit: boolean;
  readonly antiCritApplied: boolean;
}

/** Creature → player to-hit, hit quality and crit (with WIS anti-crit), seeded. */
export function seededCreatureAttack(input: {
  rng: TickRandom;
  creatureId: string;
  creatureLevel: number;
  defender: ParticipantSnapshot;
  key: readonly (string | number)[];
}): SeededCreatureAttack {
  const { rng, creatureId, creatureLevel, defender, key } = input;
  const roll = rng.roll('creature_attack_roll', 20, creatureId, defender.id, ...key);
  const totalAtk = roll + getCreatureAttackBonus(creatureLevel);
  const margin = totalAtk - defender.ac;
  const isNat1 = roll === 1;
  let isCrit = roll === 20;
  let antiCritApplied = false;

  if (isCrit) {
    const antiCrit =
      getWisAntiCrit(defender.attrs.wis) + (defender.hasShield ? 0.05 : 0);
    if (antiCrit > 0 && rng.sample('anti_crit', defender.id, creatureId, ...key) < antiCrit) {
      isCrit = false;
      antiCritApplied = true;
    }
  }

  return {
    roll,
    totalAtk,
    margin,
    quality: getHitQuality(margin, isNat1, isCrit),
    isCrit,
    antiCritApplied,
  };
}

/** Graded-hit and crit scaling for creature damage — unchanged legacy bands. */
export function scaleCreatureDamage(
  base: number,
  quality: HitQuality,
  isCrit: boolean,
  margin: number,
): number {
  if (quality === 'miss') return 0;
  let dmg = Math.floor(base * HIT_QUALITY_MULT[quality]);
  if (isCrit) dmg = Math.floor(dmg * CREATURE_CRIT_MULT);
  if (quality === 'glancing' || (quality === 'weak' && margin < -2)) {
    dmg = Math.min(dmg, GLANCING_WEAK_CAP);
  }
  return Math.max(dmg, 1);
}

/** Dodge check for an evasion stance, seeded. */
export function seededDodge(input: {
  rng: TickRandom;
  defender: ParticipantSnapshot;
  creatureId: string;
  key: readonly (string | number)[];
}): boolean {
  const chance = input.defender.buffs.dodgeChance;
  if (!(chance > 0)) return false;
  return (
    input.rng.sample('dodge', input.defender.id, input.creatureId, ...input.key) < chance
  );
}

/** Re-exported for callers that want the diminishing curve without a roll. */
export { diminishing };
