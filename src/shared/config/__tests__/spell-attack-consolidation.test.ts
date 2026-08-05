/**
 * spell-attack-consolidation.test.ts — Phase 4 of the ability consolidation.
 *
 * Pins the contract that the Wizard, Healer, Bard and Templar signature spells
 * resolve through ONE reusable base mechanic (`spell_attack`), and that the
 * Warrior's Second Wind shares the one `heal` base with the Healer's Heal.
 * Class identity (name, wording, damage type, casting attribute) lives in the
 * class assignment. A regression that re-forks a mechanic per class fails here.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getMechanicParams, MECHANIC_TEMPLATES } from '@/shared/config/mechanic-templates';
import {
  applyAssignmentOverrides, taggedScalingRoles, validateAssignmentOverrides,
} from '@/shared/config/effective-ability';

const SPELLS = ['fireball', 'smite', 'cutting_words', 'judgment'] as const;
const HEALS = ['heal', 'second_wind'] as const;
const seedOf = (key: string) => ABILITY_SEED.find(a => a.ability_key === key)!;

describe('consolidated spell strike', () => {
  it('is a registered mechanic template', () => {
    expect(MECHANIC_TEMPLATES.some(t => t.mechanicKey === 'spell_attack')).toBe(true);
    expect(getMechanicParams('spell_attack')).toEqual([]);
  });

  it('all four signature spells share the one mechanic and base ability', () => {
    for (const key of SPELLS) {
      const seed = seedOf(key);
      expect(seed.mechanic_key, key).toBe('spell_attack');
      expect(seed.base_ability_key, key).toBe('spell_attack');
    }
  });

  it('keeps a distinct per-class identity, label, damage type and verbs', () => {
    expect(new Set(SPELLS.map(k => seedOf(k).label)).size).toBe(4);
    expect(new Set(SPELLS.map(k => seedOf(k).damage_type))).toEqual(
      new Set(['fire', 'holy', 'psychic']),
    );
    for (const key of SPELLS) {
      const text = seedOf(key).combat_text as Record<string, string>;
      expect(typeof text.hit_verb, key).toBe('string');
      expect(typeof text.miss_verb, key).toBe('string');
    }
  });

  it('exposes the casting attribute as an overridable primary role', () => {
    const base = seedOf('fireball');
    expect(taggedScalingRoles(base as never)).toContain('primary');
    expect(validateAssignmentOverrides(base as never, {
      scaling: { primary_attribute: 'cha' },
    })).toEqual([]);
  });

  it('resolves a class override of the casting attribute onto the shared base', () => {
    const base = seedOf('fireball');
    const { rows, errors } = applyAssignmentOverrides([{
      class_key: 'bard',
      class_ability_key: 'cutting_words',
      overrides: { label: 'Cutting Words', scaling: { primary_attribute: 'cha' } },
      ability: { ...base, ability_key: 'spell_attack' },
    }] as never, () => undefined as never);

    expect(errors).toEqual([]);
    const effective = (rows[0] as {
      ability: { label: string; amount_calc: { terms: { source: string; stat?: string }[] } };
    }).ability;
    expect(effective.label).toBe('Cutting Words');
    expect(effective.amount_calc.terms.filter(t => t.source === 'stat').map(t => t.stat))
      .toEqual(['cha']);
  });

  it('keeps the Templar rider on the shared base rather than a forked mechanic', () => {
    expect(seedOf('judgment').amount_calc?.finalMult).toBe(0.8);
    expect(seedOf('smite').amount_calc?.finalMult).toBeUndefined();
  });
});

describe('consolidated self heal', () => {
  it('Heal and Second Wind share the one heal mechanic', () => {
    for (const key of HEALS) {
      expect(seedOf(key).mechanic_key, key).toBe('heal');
    }
    expect(seedOf('second_wind').base_ability_key).toBe('heal');
  });

  it('keeps distinct authored wording and an overridable attribute', () => {
    for (const key of HEALS) {
      const text = seedOf(key).combat_text as Record<string, string>;
      expect(typeof text.self_text, key).toBe('string');
      expect(typeof text.self_full_text, key).toBe('string');
      expect(taggedScalingRoles(seedOf(key) as never), key).toContain('primary');
    }
    const wording = HEALS.map(k => (seedOf(k).combat_text as Record<string, string>).self_text);
    expect(new Set(wording).size).toBe(2);
  });
});
