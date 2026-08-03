/**
 * effective-ability.test.ts — contract for THE shared effective-ability
 * resolver: base ability + validated class-assignment overrides.
 *
 * These are the guarantees the whole configuration model rests on:
 *  - overrides are narrow (typed allowlist, mechanic-aware),
 *  - scaling overrides may change ONLY the attribute of a role-tagged term,
 *  - an invalid override object is discarded WHOLESALE (base config, no partial
 *    merge) and reported,
 *  - roles are derived from the class's configured attributes, not hand-authored.
 */
import { describe, it, expect } from 'vitest';
import {
  applyAssignmentOverrides, resolveEffectiveAbility, tagScalingRoles,
  taggedScalingRoles, validateAssignmentOverrides,
  type BaseAbilityRow,
} from '../effective-ability';

const base: BaseAbilityRow = {
  ability_key: 'power_strike',
  label: 'Power Strike',
  description: 'A heavy blow.',
  tooltip: 'Heavy blow.',
  mechanic_key: 'power_strike',
  cp_cost: 10,
  damage_type: 'physical',
  amount_calc: {
    base: 3,
    terms: [
      { source: 'stat', stat: 'str', mult: 1.5 },
      { source: 'stat', stat: 'dex', mult: 1000 },
      { source: 'level', mult: 1 / 3 },
    ],
    unit: 'hp',
  },
  duration_calc: null,
  interval_ms: null,
  mechanic_calcs: {},
  combat_text: { cast: 'You wind up.' },
};

const warrior = { primary: 'str' as const, secondary: 'dex' as const };

describe('scaling roles are derived from class attributes', () => {
  it('tags primary and secondary terms, leaves the rest untagged', () => {
    const tagged = tagScalingRoles(base, warrior);
    const terms = tagged.amount_calc!.terms;
    expect(terms[0].role).toBe('primary');
    expect(terms[1].role).toBe('secondary');
    expect(terms[2].role).toBeUndefined();
    expect(taggedScalingRoles(tagged).sort()).toEqual(['primary', 'secondary']);
  });

  it('an untagged ability exposes no overridable role', () => {
    expect(taggedScalingRoles(base)).toEqual([]);
  });
});

describe('scaling overrides swap the attribute only', () => {
  it('keeps coefficients, transforms and rounding untouched', () => {
    const tagged = tagScalingRoles(base, warrior);
    const { ability, errors } = resolveEffectiveAbility(tagged, {
      overrides: { scaling: { primary_attribute: 'con' } },
    });
    expect(errors).toEqual([]);
    expect(ability.amount_calc!.terms[0]).toMatchObject({ stat: 'con', mult: 1.5 });
    // secondary untouched, base fields intact
    expect(ability.amount_calc!.terms[1].stat).toBe('dex');
    expect(ability.amount_calc!.base).toBe(3);
    expect(ability.cp_cost).toBe(10);
    expect(ability.ability_key).toBe('power_strike');
  });

  it('rejects a role the ability does not scale with', () => {
    const errors = validateAssignmentOverrides(base, { scaling: { primary_attribute: 'con' } });
    expect(errors.join(' ')).toContain('no primary scaling term');
  });
});

describe('overrides are narrow and fail closed', () => {
  it('rejects fields outside the allowlist', () => {
    expect(validateAssignmentOverrides(base, { cp_cost: 1 }).join(' '))
      .toContain('not an overridable field');
    expect(validateAssignmentOverrides(base, { amount_calc: { base: 0, terms: [], unit: 'hp' } }).join(' '))
      .toContain('not an overridable field');
  });

  it('rejects mechanic params that do not belong to the mechanic', () => {
    expect(validateAssignmentOverrides(base, { mechanic_calcs: { nonsense: { base: 0, terms: [], unit: 'hp' } } }).join(' '))
      .toContain('not a parameter of mechanic');
  });

  it('discards the whole override object when any part is invalid', () => {
    const tagged = tagScalingRoles(base, warrior);
    const { ability, errors } = resolveEffectiveAbility(tagged, {
      overrides: { label: 'Cleave', cp_cost: 1 },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(ability.overridden).toBe(false);
    expect(ability.label).toBe('Power Strike');
  });

  it('merges valid text overrides over the base combat text', () => {
    const { ability } = resolveEffectiveAbility(base, {
      overrides: { label: 'Cleave', combat_text: { hit: 'It bites deep.' } },
    });
    expect(ability.label).toBe('Cleave');
    expect(ability.combat_text).toEqual({ cast: 'You wind up.', hit: 'It bites deep.' });
  });
});

describe('fetch-boundary helper', () => {
  it('resolves every row and reports invalid ones without dropping them', () => {
    const rows = [
      { class_key: 'warrior', overrides: { label: 'Cleave' }, ability: base },
      { class_key: 'warrior', overrides: { cp_cost: 1 }, ability: base },
    ];
    const { rows: out, errors } = applyAssignmentOverrides(rows, () => warrior);
    expect(out).toHaveLength(2);
    expect(out[0].ability!.label).toBe('Cleave');
    expect(out[1].ability!.label).toBe('Power Strike');
    expect(errors[0]).toContain('warrior:power_strike');
  });

  it('applies class-derived roles so a scaling override validates', () => {
    const { errors } = applyAssignmentOverrides(
      [{ class_key: 'warrior', overrides: { scaling: { secondary_attribute: 'wis' } }, ability: base }],
      () => warrior,
    );
    expect(errors).toEqual([]);
  });
});
