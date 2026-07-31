/**
 * class-registry.test.ts — Phase 2 parity gate for configurable classes.
 *
 * 1. The hardcoded fallback tables must stay byte-identical to the values
 *    seeded into the `classes` table (balance-neutral migration).
 * 2. `setClassRegistry` must override every configurable field in place, so
 *    modules holding a reference to the exported records see the new values.
 * 3. Removed legacy constants must stay removed.
 */
import { describe, it, expect } from 'vitest';
import * as classes from '@/shared/formulas/classes';
import {
  CLASS_BASE_HP, CLASS_BASE_AC, CLASS_CRIT_RANGE, CLASS_LEVEL_BONUSES,
  CLASS_LABELS, CLASS_WEAPON_AFFINITY, CLASS_AUTOATTACK,
  setClassRegistry, getClassCritRange, getWeaponAffinityBonus,
  getPlayableClassKeys, isPreClass,
} from '@/shared/formulas/classes';

/** Snapshot of the rows seeded into `public.classes` (Phase 1a seed). */
const SEEDED = {
  classless: { label: 'Wayfarer', base_hp: 18, base_ac: 10, crit_range: 20, level_bonuses: {}, weapons: [] as string[] },
  warrior:  { label: 'Warrior',  base_hp: 24, base_ac: 12, crit_range: 20, level_bonuses: { str: 1, dex: 1 }, weapons: ['sword', 'axe', 'mace'] },
  wizard:   { label: 'Wizard',   base_hp: 16, base_ac: 9,  crit_range: 20, level_bonuses: { int: 1, wis: 1 }, weapons: ['staff', 'wand'] },
  ranger:   { label: 'Ranger',   base_hp: 20, base_ac: 10, crit_range: 20, level_bonuses: { dex: 1, wis: 1 }, weapons: ['bow', 'dagger'] },
  assassin: { label: 'Assassin', base_hp: 16, base_ac: 10, crit_range: 19, level_bonuses: { dex: 1, cha: 1 }, weapons: ['dagger', 'sword'] },
  healer:   { label: 'Healer',   base_hp: 18, base_ac: 9,  crit_range: 20, level_bonuses: { wis: 1, con: 1 }, weapons: ['mace', 'staff'] },
  bard:     { label: 'Bard',     base_hp: 16, base_ac: 9,  crit_range: 20, level_bonuses: { cha: 1, int: 1 }, weapons: ['sword', 'wand'] },
  templar:  { label: 'Templar',  base_hp: 22, base_ac: 12, crit_range: 20, level_bonuses: { wis: 1, con: 1 }, weapons: ['sword', 'mace'] },
} as const;

describe('class fallback tables match the seeded classes rows', () => {
  for (const [key, row] of Object.entries(SEEDED)) {
    it(`${key} is balance-identical`, () => {
      expect(CLASS_LABELS[key]).toBe(row.label);
      expect(CLASS_BASE_HP[key]).toBe(row.base_hp);
      expect(CLASS_BASE_AC[key]).toBe(row.base_ac);
      expect(CLASS_LEVEL_BONUSES[key]).toEqual(row.level_bonuses);
      if (key !== 'classless') {
        expect(CLASS_CRIT_RANGE[key]).toBe(row.crit_range);
        expect(CLASS_WEAPON_AFFINITY[key]).toEqual(row.weapons);
        expect(CLASS_AUTOATTACK[key]).toBeTruthy();
      }
    });
  }

  it('classless is the only pre-class row and is not playable', () => {
    expect(isPreClass('classless')).toBe(true);
    expect(getPlayableClassKeys()).not.toContain('classless');
    expect(getPlayableClassKeys().sort()).toEqual(
      Object.keys(SEEDED).filter(k => k !== 'classless').sort(),
    );
  });
});

describe('setClassRegistry overrides configuration in place', () => {
  it('applies base HP/AC, crit range, level bonuses, affinity and autoattack', () => {
    setClassRegistry([{
      class_key: 'warrior',
      label: 'Vanguard',
      base_hp: 30,
      base_ac: 14,
      crit_range: 18,
      level_bonuses: { str: 2 },
      weapon_proficiencies: ['axe'],
      autoattack: { emoji: '🪓', verb: 'cleaves', selfVerb: 'cleave into' },
      is_pre_class: false,
      is_selectable: true,
      sort_order: 1,
      status: 'active',
    }]);

    expect(CLASS_LABELS.warrior).toBe('Vanguard');
    expect(CLASS_BASE_HP.warrior).toBe(30);
    expect(CLASS_BASE_AC.warrior).toBe(14);
    expect(getClassCritRange('warrior')).toBe(18);
    expect(CLASS_LEVEL_BONUSES.warrior).toEqual({ str: 2 });
    expect(getWeaponAffinityBonus('warrior', 'axe')).toEqual({ hitBonus: 1, damageMult: 1.10 });
    expect(getWeaponAffinityBonus('warrior', 'sword')).toEqual({ hitBonus: 0, damageMult: 1 });
    expect(CLASS_AUTOATTACK.warrior.emoji).toBe('🪓');
    // Unspecified autoattack fields are preserved.
    expect(CLASS_AUTOATTACK.warrior.stat).toBe('str');

    // Restore so other suites see the seeded values.
    setClassRegistry([{
      class_key: 'warrior',
      label: 'Warrior',
      base_hp: 24,
      base_ac: 12,
      crit_range: 20,
      level_bonuses: { str: 1, dex: 1 },
      weapon_proficiencies: ['sword', 'axe', 'mace'],
      autoattack: { label: 'Strike', stat: 'str', diceMin: 1, diceMax: 10, emoji: '⚔️', verb: 'swings at', selfVerb: 'swing your blade at' },
    }]);
    expect(CLASS_BASE_HP.warrior).toBe(24);
  });

  it('ignores empty payloads', () => {
    setClassRegistry([]);
    expect(CLASS_BASE_HP.warrior).toBe(24);
  });
});

describe('legacy class constants are gone', () => {
  it('CLASS_COMBAT_PROFILES and TWO_HANDED_DAMAGE_MULT are removed', () => {
    expect((classes as Record<string, unknown>).CLASS_COMBAT_PROFILES).toBeUndefined();
    expect((classes as Record<string, unknown>).TWO_HANDED_DAMAGE_MULT).toBeUndefined();
  });
});
