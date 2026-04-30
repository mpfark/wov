/**
 * classes.ts — Class-related constants used by combat & resource math.
 *
 * CANONICAL OWNER for: CLASS_BASE_HP, CLASS_BASE_AC, CLASS_LEVEL_BONUSES,
 * CLASS_LABELS, CLASS_WEAPON_AFFINITY, CLASS_COMBAT_PROFILES,
 * weapon/shield mechanics constants.
 *
 * NOTE: Race/class descriptions and stat tables (RACE_STATS, CLASS_STATS,
 * RACE_LABELS, RACE_DESCRIPTIONS, CLASS_DESCRIPTIONS, STAT_LABELS) live in
 * `src/lib/game-data.ts` because they are UI-only and not needed by the
 * server combat path.
 */

export const CLASS_BASE_HP: Record<string, number> = {
  warrior: 24, wizard: 16, ranger: 20, rogue: 16, healer: 18, bard: 16, templar: 22,
};

export const CLASS_BASE_AC: Record<string, number> = {
  warrior: 12, wizard: 9, ranger: 10, rogue: 10, healer: 9, bard: 9, templar: 12,
};

/** Class-based stat bonuses awarded every 3 levels */
export const CLASS_LEVEL_BONUSES: Record<string, Record<string, number>> = {
  warrior: { str: 1, dex: 1 },
  wizard:  { int: 1, wis: 1 },
  ranger:  { dex: 1, wis: 1 },
  rogue:   { dex: 1, cha: 1 },
  healer:  { wis: 1, con: 1 },
  bard:    { cha: 1, int: 1 },
  templar: { wis: 1, con: 1 },
};

export const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger',
  rogue: 'Rogue', healer: 'Healer', bard: 'Bard', templar: 'Templar',
};

export const CLASS_WEAPON_AFFINITY: Record<string, string[]> = {
  warrior: ['sword', 'axe', 'mace'],
  ranger:  ['bow', 'dagger'],
  rogue:   ['dagger', 'sword'],
  wizard:  ['staff', 'wand'],
  healer:  ['mace', 'staff'],
  bard:    ['sword', 'wand'],
  templar: ['sword', 'mace'],
};

export interface ClassAttackProfile {
  stat: string;
  diceMin: number;
  diceMax: number;
  critRange: number;
  emoji: string;
  verb: string;
}

/**
 * @deprecated LEGACY (basic-combat-rework v2): Autoattacks no longer read
 * `stat`/`diceMin`/`diceMax`/`verb`/`emoji` from this table. Damage is now
 * weapon-based (see `WEAPON_DAMAGE_DIE` in `combat.ts`) with STR scaling.
 *
 * Kept exported because:
 *   1. Three ability handlers (multi_attack, execute_attack, ignite_consume)
 *      still read dice from here pending the T0 ability rewrite.
 *   2. Some UI/admin screens still display class profile info.
 *
 * Class crit edge (rogue 19) now lives in `CLASS_CRIT_RANGE` below.
 */
export const CLASS_COMBAT_PROFILES: Record<string, ClassAttackProfile> = {
  warrior: { stat: 'str', diceMin: 1, diceMax: 10, critRange: 20, emoji: '⚔️', verb: 'swings at' },
  wizard:  { stat: 'int', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '🔥', verb: 'hurls flame at' },
  ranger:  { stat: 'dex', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '🏹', verb: 'shoots' },
  rogue:   { stat: 'dex', diceMin: 1, diceMax: 6,  critRange: 19, emoji: '🗡️', verb: 'strikes' },
  healer:  { stat: 'wis', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '⭐', verb: 'smites' },
  bard:    { stat: 'cha', diceMin: 1, diceMax: 6,  critRange: 20, emoji: '🎵', verb: 'mocks' },
  templar: { stat: 'wis', diceMin: 1, diceMax: 8,  critRange: 20, emoji: '✝️', verb: 'smites with righteous steel' },
};

/**
 * Per-class natural-d20 crit threshold. A roll >= this number crits before
 * DEX/buff reductions are applied. Most classes crit on natural 20; rogue
 * keeps a slightly wider crit range (19-20) as a class identity perk.
 */
export const CLASS_CRIT_RANGE: Record<string, number> = {
  warrior: 20, wizard: 20, ranger: 20, rogue: 19, healer: 20, bard: 20, templar: 20,
};

export function getClassCritRange(classKey: string): number {
  return CLASS_CRIT_RANGE[classKey] ?? 20;
}

/** Weapon tags that grant an off-hand bonus attack (shields do NOT) */
export const OFFHAND_WEAPON_TAGS = ['sword', 'axe', 'mace', 'dagger', 'bow', 'staff', 'wand'];
/** Off-hand damage multiplier (30% of main-hand base damage) */
export const OFFHAND_DAMAGE_MULT = 0.30;
/**
 * @deprecated Autoattacks no longer apply this multiplier. The two-handed
 * damage benefit is now expressed entirely through a larger weapon die in
 * `WEAPON_DAMAGE_DIE` (see `combat.ts`). Kept exported only to avoid breaking
 * legacy imports; do not use in new code.
 */
export const TWO_HANDED_DAMAGE_MULT = 1.25;

export const SHIELD_AC_BONUS = 1;
/** Shield grants +5% anti-crit on top of WIS-based anti-crit */
export const SHIELD_ANTI_CRIT_BONUS = 0.05;

export function isShield(tag?: string | null): boolean {
  return tag === 'shield';
}

/** Returns hit bonus and damage multiplier when class matches weapon tag */
export function getWeaponAffinityBonus(
  classKey: string,
  weaponTag?: string | null,
): { hitBonus: number; damageMult: number } {
  if (!weaponTag) return { hitBonus: 0, damageMult: 1 };
  const tags = CLASS_WEAPON_AFFINITY[classKey];
  if (tags && tags.includes(weaponTag)) return { hitBonus: 1, damageMult: 1.10 };
  return { hitBonus: 0, damageMult: 1 };
}

/** Check whether the off-hand item is a weapon (not a shield) and thus grants a bonus attack */
export function isOffhandWeapon(offhandTag?: string | null): boolean {
  return !!offhandTag && OFFHAND_WEAPON_TAGS.includes(offhandTag);
}
