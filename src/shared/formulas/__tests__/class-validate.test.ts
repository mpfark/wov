/**
 * class-validate.test.ts — Phase 3 guards for the class config validator.
 */
import { describe, it, expect } from 'vitest';
import {
  validateClassConfig, validateClassLifecycle, type ClassConfigDraft,
} from '../class-validate';

const base: ClassConfigDraft = {
  class_key: 'warrior',
  label: 'Warrior',
  status: 'active',
  is_pre_class: false,
  is_selectable: true,
  sort_order: 1,
  base_hp: 24,
  base_ac: 12,
  crit_range: 20,
  level_bonuses: { str: 1, dex: 1 },
  weapon_proficiencies: ['sword', 'axe', 'mace'],
  autoattack: {
    label: 'Strike', stat: 'str', diceMin: 1, diceMax: 10,
    emoji: '⚔️', verb: 'swings at', selfVerb: 'swing your blade at',
  },
};

describe('validateClassConfig', () => {
  it('accepts the seeded warrior row', () => {
    expect(validateClassConfig(base)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects out-of-range baselines and bad keys', () => {
    const { errors } = validateClassConfig({
      ...base, class_key: 'War Rior', base_hp: 99, base_ac: 40, crit_range: 12,
    });
    expect(errors.length).toBe(4);
  });

  it('rejects unknown stats, tags and broken autoattack dice', () => {
    const { errors } = validateClassConfig({
      ...base,
      level_bonuses: { luck: 1 },
      weapon_proficiencies: ['spork'],
      autoattack: { ...base.autoattack, diceMin: 8, diceMax: 4 },
    });
    expect(errors.some(e => e.includes('luck'))).toBe(true);
    expect(errors.some(e => e.includes('spork'))).toBe(true);
    expect(errors.some(e => e.includes('diceMax'))).toBe(true);
  });

  it('warns when level bonuses do not total 2', () => {
    const { warnings, errors } = validateClassConfig({ ...base, level_bonuses: { str: 1 } });
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.includes('total 1'))).toBe(true);
  });

  it('exempts the pre-class row from autoattack and proficiency requirements', () => {
    const { errors } = validateClassConfig({
      ...base,
      class_key: 'classless', label: 'Wayfarer', is_pre_class: true, is_selectable: false,
      level_bonuses: {}, weapon_proficiencies: [], autoattack: {},
    });
    expect(errors).toHaveLength(0);
  });
});

describe('validateClassLifecycle', () => {
  it('blocks retiring a class with living characters', () => {
    const { errors } = validateClassLifecycle({
      nextStatus: 'retired', nextSelectable: false, isPreClass: false,
      liveCharacters: 3, abilityGaps: 0,
    });
    expect(errors.some(e => e.includes('reassign'))).toBe(true);
  });

  it('blocks selectable on a non-active class', () => {
    const { errors } = validateClassLifecycle({
      nextStatus: 'draft', nextSelectable: true, isPreClass: false,
      liveCharacters: 0, abilityGaps: 0,
    });
    expect(errors.some(e => e.includes('Only an active class'))).toBe(true);
  });

  it('warns about empty ability slots on an active class', () => {
    const { errors, warnings } = validateClassLifecycle({
      nextStatus: 'active', nextSelectable: true, isPreClass: false,
      liveCharacters: 2, abilityGaps: 1,
    });
    expect(errors).toHaveLength(0);
    expect(warnings.some(w => w.includes('empty bar slot'))).toBe(true);
  });
});
