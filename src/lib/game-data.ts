/**
 * game-data.ts — Static UI data (race/class labels, descriptions, weapon
 * vocabulary, milestone titles) plus a thin barrel re-export of every
 * gameplay formula.
 *
 * Formula ownership lives under `src/shared/formulas/`. This module keeps
 * the historic `@/lib/game-data` import path alive for the ~30 call sites
 * across the app, but new code should generally import formulas directly
 * from their canonical module:
 *
 *   import { getMaxHp } from '@/shared/formulas/resources';
 *
 * What stays in this file:
 *   - RACE_STATS / CLASS_STATS         (character creation stat math)
 *   - RACE_LABELS / CLASS_LABELS       (UI display)  ← CLASS_LABELS also re-exported via formulas/classes
 *   - RACE_DESCRIPTIONS / CLASS_DESCRIPTIONS / STAT_LABELS
 *   - WEAPON_TAGS / WEAPON_TAG_LABELS  (admin UI)
 *   - MILESTONE_TITLES + getCharacterTitle
 *   - calculateStats, calculateHP, calculateAC (legacy convenience wrappers)
 */

// ── Barrel re-export of canonical formulas ──────────────────────
export * from '@/shared/formulas/stats';
export * from '@/shared/formulas/classes';
export * from '@/shared/formulas/resources';
export * from '@/shared/formulas/combat';
export * from '@/shared/formulas/xp';
export * from '@/shared/formulas/items';
export * from '@/shared/formulas/creatures';
export * from '@/shared/formulas/economy';

// ── Deprecated compatibility shim (still used by CharacterPanel.tsx) ─
import { getWisAntiCrit } from '@/shared/formulas/combat';

/** @deprecated Renamed to `getWisAntiCrit`. WIS no longer grants outright dodge.
 *  Migrate `CharacterPanel.tsx` and remove. */
export function getWisDodgeChance(wis: number): number {
  return getWisAntiCrit(wis);
}

// ── Static data: races / classes ────────────────────────────────

import { CLASS_BASE_HP } from '@/shared/formulas/classes';
import { getStatModifier } from '@/shared/formulas/stats';

/** D&D-style stat modifiers by race */
export const RACE_STATS: Record<string, Record<string, number>> = {
  human:    { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
  elf:      { str: -1, dex: 2, con: -1, int: 2, wis: 3, cha: 0 },
  dwarf:    { str: 2, dex: -1, con: 4, int: 0, wis: 1, cha: -2 },
  halfling: { str: -2, dex: 3, con: 1, int: 0, wis: 1, cha: 2 },
  edain:    { str: 1, dex: 0, con: 3, int: 1, wis: 1, cha: 1 },
  half_elf: { str: 0, dex: 1, con: 0, int: 1, wis: 2, cha: 3 },
};

/** Base stats by class */
export const CLASS_STATS: Record<string, Record<string, number>> = {
  warrior: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
  wizard:  { str: 0, dex: 0, con: 0, int: 3, wis: 2, cha: 1 },
  ranger:  { str: 1, dex: 3, con: 1, int: 0, wis: 2, cha: 0 },
  rogue:   { str: 0, dex: 3, con: 0, int: 1, wis: 0, cha: 2 },
  healer:  { str: 0, dex: 0, con: 1, int: 1, wis: 3, cha: 2 },
  bard:    { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 3 },
};

export const RACE_LABELS: Record<string, string> = {
  human: 'Human', elf: 'Elf', dwarf: 'Dwarf', halfling: 'Halfling',
  edain: 'Edain', half_elf: 'Half-Elf',
};

export const RACE_DESCRIPTIONS: Record<string, string> = {
  human: 'Versatile and adaptable, the race of Men brings balanced abilities to any endeavor.',
  elf: 'Graceful and wise, the Elder Folk excel in dexterity and have keen minds.',
  dwarf: 'Stout and hardy, the Mountain Clans are strong of arm and iron of constitution.',
  halfling: 'Small but nimble, Halflings possess surprising resilience and charm.',
  edain: 'Noble descendants of the Old Kingdom, blessed with endurance and long life.',
  half_elf: 'Children of two worlds, Half-Elves combine elvish grace with human charisma.',
};

export const CLASS_DESCRIPTIONS: Record<string, string> = {
  warrior: 'Masters of martial combat, clad in heavy armor with devastating melee power.',
  wizard: 'Wielders of ancient lore and arcane power drawn from the fabric of the world.',
  ranger: 'Swift hunters and trackers of the wild, deadly with bow and blade.',
  rogue: 'Shadow-walkers skilled in stealth, cunning strikes, and misdirection.',
  healer: 'Servants of light who mend wounds and bolster allies through divine grace.',
  bard: 'Loremasters whose songs inspire courage and whose words can shape fate.',
};

export const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};

export const WEAPON_TAGS = ['sword', 'axe', 'mace', 'dagger', 'bow', 'staff', 'wand', 'shield'] as const;

export const WEAPON_TAG_LABELS: Record<string, string> = {
  sword: 'Sword', axe: 'Axe', mace: 'Mace', dagger: 'Dagger',
  bow: 'Bow', staff: 'Staff', wand: 'Wand', shield: 'Shield',
};

// ── Character creation helpers ──────────────────────────────────

export function calculateStats(race: string, charClass: string) {
  const baseStats = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
  const raceBonus = RACE_STATS[race] || {};
  const classBonus = CLASS_STATS[charClass] || {};
  const stats: Record<string, number> = {};
  for (const stat of Object.keys(baseStats)) {
    stats[stat] = (baseStats as any)[stat] + (raceBonus[stat] || 0) + (classBonus[stat] || 0);
  }
  return stats;
}

/** @deprecated Use getMaxHp(charClass, con, level) for the full level-aware value. */
export function calculateHP(charClass: string, con: number) {
  const baseHP = CLASS_BASE_HP[charClass] || 18;
  return baseHP + getStatModifier(con);
}

// ── Nobility titles by level (every 2 levels from 28–42) ────────

const MILESTONE_TITLES: { level: number; male: string; female: string }[] = [
  { level: 42, male: 'Emperor', female: 'Empress' },
  { level: 40, male: 'King', female: 'Queen' },
  { level: 38, male: 'Prince', female: 'Princess' },
  { level: 36, male: 'Duke', female: 'Duchess' },
  { level: 34, male: 'Marquis', female: 'Marquise' },
  { level: 32, male: 'Count', female: 'Countess' },
  { level: 30, male: 'Baron', female: 'Baroness' },
  { level: 28, male: 'Lord', female: 'Lady' },
];

export function getCharacterTitle(level: number, gender: 'male' | 'female' = 'male'): string | null {
  for (const m of MILESTONE_TITLES) {
    if (level >= m.level) return gender === 'female' ? m.female : m.male;
  }
  return null;
}
