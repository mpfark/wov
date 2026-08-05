/**
 * weapon-attack-consolidation.test.ts — Phase 3 of the ability consolidation.
 *
 * Pins the contract that the Warrior, Ranger and Assassin signature strikes now
 * resolve through ONE reusable base mechanic (`weapon_attack`), with the class
 * assignment supplying identity (name/wording) and the primary scaling
 * attribute. A regression that re-forks the mechanic per class fails here.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getMechanicParams, MECHANIC_TEMPLATES } from '@/shared/config/mechanic-templates';
import {
  applyAssignmentOverrides, taggedScalingRoles, validateAssignmentOverrides,
} from '@/shared/config/effective-ability';

const SIGNATURES = ['power_strike', 'aimed_shot', 'backstab'] as const;
const seedOf = (key: string) => ABILITY_SEED.find(a => a.ability_key === key)!;

describe('consolidated weapon strike', () => {
  it('is a registered mechanic template', () => {
    expect(MECHANIC_TEMPLATES.some(t => t.mechanicKey === 'weapon_attack')).toBe(true);
    expect(getMechanicParams('weapon_attack')).toEqual([]);
  });

  it('all three signature strikes share the one mechanic and base ability', () => {
    for (const key of SIGNATURES) {
      const seed = seedOf(key);
      expect(seed.mechanic_key, key).toBe('weapon_attack');
      expect(seed.base_ability_key, key).toBe('weapon_attack');
    }
  });

  it('keeps a distinct per-class identity, label and verbs', () => {
    const labels = SIGNATURES.map(k => seedOf(k).label);
    expect(new Set(labels).size).toBe(3);
    for (const key of SIGNATURES) {
      const text = seedOf(key).combat_text as Record<string, string>;
      expect(typeof text.hit_verb, key).toBe('string');
      expect(typeof text.miss_verb, key).toBe('string');
    }
  });

  it('exposes the scaling attribute as an overridable primary role', () => {
    const base = { ...seedOf('power_strike'), effect_config: seedOf('power_strike').effect_config };
    expect(taggedScalingRoles(base as never)).toContain('primary');
    expect(validateAssignmentOverrides(base as never, {
      scaling: { primary_attribute: 'dex' },
    })).toEqual([]);
  });

  it('resolves a class override of the scaling attribute onto the shared base', () => {
    const base = seedOf('power_strike');
    const { rows, errors } = applyAssignmentOverrides([{
      class_key: 'ranger',
      class_ability_key: 'aimed_shot',
      overrides: {
        label: 'Aimed Shot',
        scaling: { primary_attribute: 'dex' },
      },
      ability: { ...base, ability_key: 'weapon_attack' },
    }] as never, () => undefined as never);

    expect(errors).toEqual([]);
    const effective = (rows[0] as { ability: { label: string; amount_calc: { terms: { source: string; stat?: string }[] } } }).ability;
    expect(effective.label).toBe('Aimed Shot');
    const stats = effective.amount_calc.terms
      .filter(t => t.source === 'stat').map(t => t.stat);
    expect(stats).toEqual(['dex', 'dex']);
  });

  it('declares the bounded on-hit effect allowlist on the shared base', () => {
    const config = seedOf('backstab').effect_config as { on_hit_allowed?: string[] };
    expect(config.on_hit_allowed).toEqual(['bleed', 'poison']);
  });
});
