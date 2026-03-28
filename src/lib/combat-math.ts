/**
 * combat-math.ts — Shared combat formulas used by both client (usePartyCombat.ts)
 * and server (combat-tick edge function).
 *
 * IMPORTANT: This file must remain pure TypeScript with zero framework/browser/Deno
 * dependencies so it can be imported in both environments.
 *
 * A mirrored copy lives at src/lib/combat-math.ts for client-side imports.
 * If you change formulas here, update the mirror too (or vice versa).
 */

// ── Core stat helpers ────────────────────────────────────────────

/** D&D-style stat modifier: floor((stat - 10) / 2) */
export function getStatModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

/** Roll a d20 (1–20) */
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

/** Roll damage in range [min, max] inclusive */
export function rollDamage(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Diminishing returns helpers ──────────────────────────────────

/** Integer diminishing return: floor(sqrt(mod)), capped */
export function diminishing(mod: number, cap: number): number {
  return Math.min(cap, Math.floor(Math.sqrt(Math.max(0, mod))));
}

/** Float diminishing return: sqrt(mod) * perPoint, capped */
export function diminishingFloat(mod: number, perPoint: number, cap: number): number {
  return Math.min(cap, Math.sqrt(Math.max(0, mod)) * perPoint);
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

/** WIS → Awareness (chance to reduce incoming damage by 25%): sqrt curve, capped at 15% */
export function getWisDodgeChance(wis: number): number {
  return diminishingFloat(getStatModifier(wis), 0.03, 0.15);
}

/** STR → Minimum damage floor: sqrt curve, capped at +3 */
export function getStrDamageFloor(str: number): number {
  return diminishing(getStatModifier(str), 3);
}

/** CHA → Bonus gold multiplier from humanoid kills: sqrt curve, capped at +25% */
export function getChaGoldMultiplier(cha: number): number {
  return 1 + diminishingFloat(getStatModifier(cha), 0.05, 0.25);
}

// ── DEX multi-attack (party mode) ───────────────────────────────

/** DEX mod → number of attacks per 2s tick (currently unused, kept for reference) */
export function getDexMultiAttack(dex: number): number {
  const m = getStatModifier(dex);
  return m >= 5 ? 3 : m >= 3 ? 2 : 1;
}

// ── Creature damage ──────────────────────────────────────────────

const CREATURE_DAMAGE_BASE: Record<string, number> = {
  regular: 4, rare: 6, boss: 10,
};

/** Creature damage die max based on level and rarity */
export function getCreatureDamageDie(level: number, rarity: string): number {
  const base = CREATURE_DAMAGE_BASE[rarity] || 4;
  return base + Math.floor(level * 0.7);
}

/** Bonus damage multiplier when creature out-levels the player (+8% per level diff) */
export function getCreatureLevelGapMultiplier(creatureLevel: number, playerLevel: number): number {
  const diff = Math.max(creatureLevel - playerLevel, 0);
  return 1 + diff * 0.08;
}

// ── XP formulas ──────────────────────────────────────────────────

export const XP_RARITY_MULTIPLIER: Record<string, number> = {
  regular: 1, rare: 1.5, boss: 2.5,
};

/** XP required to reach the next level */
export function getXpForLevel(level: number): number {
  return Math.floor(Math.pow(level, 2.0) * 50);
}

/** Graduated XP penalty for out-leveling creatures */
export function getXpPenalty(playerLevel: number, creatureLevel: number): number {
  const diff = Math.max(playerLevel - creatureLevel, 0);
  let rate = 0.20;
  if (playerLevel <= 5) rate = 0.10;
  else if (playerLevel <= 10) rate = 0.15;
  return Math.max(1 - diff * rate, 0.10);
}

// ── CP / MP formulas ─────────────────────────────────────────────

/** Max Concentration Points — scales with INT + WIS */
export function getMaxCp(level: number, int: number = 10, wis: number = 10, _cha: number = 10): number {
  const intMod = Math.max(getStatModifier(int), 0);
  const wisMod = Math.max(getStatModifier(wis), 0);
  return 30 + (level - 1) * 3 + (intMod + wisMod) * 3;
}

/** Max Movement Points (stamina) */
export function getMaxMp(level: number, dex: number = 10): number {
  const dexMod = Math.max(getStatModifier(dex), 0);
  return 100 + dexMod * 10 + Math.floor((level - 1) * 2);
}

// ── AC overflow damage reduction ─────────────────────────────────

/**
 * When a creature crits (forcing a hit) but its total attack roll is below
 * the target's AC, the excess AC reduces damage proportionally.
 * Reduction = (AC - totalAtk) / AC, capped at 50%.
 * Returns the multiplier to apply to damage (e.g. 0.59 means 41% reduction).
 */
export function getAcOverflowMultiplier(totalAtk: number, targetAC: number): number {
  if (totalAtk >= targetAC || targetAC <= 0) return 1;
  const overflow = targetAC - totalAtk;
  const reduction = Math.min(overflow / targetAC, 0.50);
  return 1 - reduction;
}

// ── AC formula ───────────────────────────────────────────────────

const CLASS_BASE_AC: Record<string, number> = {
  warrior: 14, wizard: 11, ranger: 12, rogue: 12, healer: 11, bard: 11,
};

/** AC = base class AC + DEX modifier */
export function calculateAC(charClass: string, dex: number): number {
  const baseAC = CLASS_BASE_AC[charClass] || 10;
  return baseAC + getStatModifier(dex);
}

// ── Max HP formula ───────────────────────────────────────────────

const CLASS_BASE_HP: Record<string, number> = {
  warrior: 24, wizard: 16, ranger: 20, rogue: 16, healer: 18, bard: 16,
};

/** Max HP = base class HP + CON modifier + (level-1)*5 */
export function getMaxHp(charClass: string, con: number, level: number): number {
  const baseHP = CLASS_BASE_HP[charClass] || 18;
  return baseHP + getStatModifier(con) + (level - 1) * 5;
}

// ── Class combat data ────────────────────────────────────────────

export interface ClassAttackProfile {
  stat: string;
  diceMin: number;
  diceMax: number;
  critRange: number;
  emoji: string;
  verb: string;
}

export const CLASS_COMBAT_PROFILES: Record<string, ClassAttackProfile> = {
  warrior: { stat: 'str', diceMin: 1, diceMax: 10, critRange: 20, emoji: '⚔️', verb: 'swings at' },
  wizard:  { stat: 'int', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '🔥', verb: 'hurls flame at' },
  ranger:  { stat: 'dex', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '🏹', verb: 'shoots' },
  rogue:   { stat: 'dex', diceMin: 1, diceMax: 6,  critRange: 19, emoji: '🗡️', verb: 'strikes' },
  healer:  { stat: 'wis', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '⭐', verb: 'smites' },
  bard:    { stat: 'cha', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '🎵', verb: 'mocks' },
};

/** Class-based stat bonuses awarded every 3 levels */
export const CLASS_LEVEL_BONUSES: Record<string, Record<string, number>> = {
  warrior: { str: 1, dex: 1 },
  wizard:  { int: 1, wis: 1 },
  ranger:  { dex: 1, wis: 1 },
  rogue:   { dex: 1, cha: 1 },
  healer:  { wis: 1, con: 1 },
  bard:    { cha: 1, int: 1 },
};

export const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger',
  rogue: 'Rogue', healer: 'Healer', bard: 'Bard',
};

// ── Weapon affinity ──────────────────────────────────────────────

export const CLASS_WEAPON_AFFINITY: Record<string, string[]> = {
  warrior: ['sword', 'axe', 'mace'],
  ranger:  ['bow', 'dagger'],
  rogue:   ['dagger', 'sword'],
  wizard:  ['staff', 'wand'],
  healer:  ['mace', 'staff'],
  bard:    ['sword', 'wand'],
};

/** Returns hit bonus and damage multiplier when class matches weapon tag */
export function getWeaponAffinityBonus(classKey: string, weaponTag?: string | null): { hitBonus: number; damageMult: number } {
  if (!weaponTag) return { hitBonus: 0, damageMult: 1 };
  const tags = CLASS_WEAPON_AFFINITY[classKey];
  if (tags && tags.includes(weaponTag)) return { hitBonus: 1, damageMult: 1.10 };
  return { hitBonus: 0, damageMult: 1 };
}

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
export function resolveAttackRoll(ctx: AttackContext, creatureAC: number, sunderReduction: number = 0): AttackResult {
  const profile = CLASS_COMBAT_PROFILES[ctx.classKey] || CLASS_COMBAT_PROFILES.warrior;
  const sMod = getStatModifier(ctx.attackerStat);
  const ihb = getIntHitBonus(ctx.int);
  const dcb = getDexCritBonus(ctx.dex);
  const mileCrit = ctx.level >= 28 ? 1 : 0;
  const effCrit = profile.critRange - dcb - mileCrit - (ctx.critBuffBonus || 0);
  const sdf = getStrDamageFloor(ctx.str);

  const roll = rollD20();
  const totalAtk = roll + sMod + ihb;
  const effectiveAC = Math.max(creatureAC - sunderReduction, 0);

  const hit = roll >= effCrit || (roll !== 1 && totalAtk >= effectiveAC);
  const isCrit = roll >= effCrit;

  let baseDamage = 0;
  if (hit) {
    const rawDmg = rollDamage(profile.diceMin, profile.diceMax) + sMod;
    baseDamage = isCrit ? Math.max(Math.floor(rawDmg * 1.5), 1) : Math.max(rawDmg, 1 + sdf);
  }

  return { hit, isCrit, roll, totalAtk, effectiveCreatureAC: effectiveAC, baseDamage, intHitBonus: ihb, strFloor: sdf };
}

/**
 * Apply offensive buff multipliers to base damage.
 * Returns final damage and which one-shot buffs were consumed.
 */
export function applyOffensiveBuffs(
  baseDamage: number,
  opts: {
    isStealth?: boolean;
    isDamageBuff?: boolean;
    focusStrikeDmg?: number;
    disengageMult?: number;
  }
): { finalDamage: number; consumed: string[] } {
  let dmg = baseDamage;
  const consumed: string[] = [];

  if (opts.isStealth) {
    dmg *= 2;
    consumed.push('stealth');
  }
  if (opts.isDamageBuff) {
    dmg = Math.floor(dmg * 1.5);
  }
  if (opts.focusStrikeDmg) {
    dmg += opts.focusStrikeDmg;
    consumed.push('focus_strike');
  }
  if (opts.disengageMult) {
    dmg = Math.floor(dmg * (1 + opts.disengageMult));
    consumed.push('disengage');
  }

  return { finalDamage: Math.max(dmg, 1), consumed };
}

/**
 * Calculate kill rewards (XP and gold) for a creature death.
 */
export function calculateKillRewards(
  creatureLevel: number,
  creatureRarity: string,
  lootTable: any[],
  isHumanoid: boolean,
  killerCha: number,
  xpMultiplier: number,
  memberLevels: number[],
  splitCount: number
): { xpShares: number[]; goldEach: number; totalGold: number } {
  const baseXp = Math.floor(creatureLevel * 10 * (XP_RARITY_MULTIPLIER[creatureRarity] || 1));
  
  const goldEntry = lootTable?.find((e: any) => e.type === 'gold');
  let totalGold = 0;
  if (goldEntry && Math.random() <= (goldEntry.chance || 0.5)) {
    totalGold = Math.floor(goldEntry.min + Math.random() * (goldEntry.max - goldEntry.min + 1));
    if (isHumanoid) {
      totalGold = Math.floor(totalGold * getChaGoldMultiplier(killerCha));
    }
  }
  const goldEach = Math.floor(totalGold / splitCount);

  // Per-member XP with individual level penalties
  const xpShares = memberLevels.map(lvl => {
    const penalty = getXpPenalty(lvl, creatureLevel);
    return Math.floor(Math.floor(baseXp * penalty * xpMultiplier) / splitCount);
  });

  return { xpShares, goldEach, totalGold };
}

/** Resolve creature counterattack damage (before defensive buffs) */
export function rollCreatureDamage(creatureLevel: number, creatureRarity: string, creatureStr: number, playerLevel?: number): number {
  const dmgDie = getCreatureDamageDie(creatureLevel, creatureRarity);
  const baseDmg = Math.max(rollDamage(1, dmgDie) + getStatModifier(creatureStr), 1);
  if (playerLevel != null) {
    return Math.max(Math.floor(baseDmg * getCreatureLevelGapMultiplier(creatureLevel, playerLevel)), 1);
  }
  return baseDmg;
}

/**
 * Apply defensive modifiers to incoming damage.
 */
export function applyDefensiveBuffs(
  damage: number,
  opts: {
    isRooted?: boolean;
    wisAwarenessChance?: number;
    absorbShieldHp?: number;
  }
): { finalDamage: number; absorbed: number; remainingShield: number; wisReduced: boolean } {
  let dmg = damage;
  let wisReduced = false;

  if (opts.isRooted) {
    dmg = Math.max(Math.floor(dmg * 0.7), 1);
  }

  if (opts.wisAwarenessChance && opts.wisAwarenessChance > 0 && Math.random() < opts.wisAwarenessChance) {
    dmg = Math.max(Math.floor(dmg * 0.75), 1);
    wisReduced = true;
  }

  let absorbed = 0;
  let remainingShield = opts.absorbShieldHp ?? 0;
  if (remainingShield > 0) {
    absorbed = Math.min(dmg, remainingShield);
    remainingShield -= absorbed;
    dmg -= absorbed;
  }

  return { finalDamage: Math.max(dmg, 0), absorbed, remainingShield, wisReduced };
}
