/**
 * class-authoring.test.ts — Phase 4 guards for class/ability authoring.
 */
import { describe, it, expect } from 'vitest';
import {
  CLASS_ROLE_TEMPLATE, suggestAbilityKey, validateNewAbility, validateNewClassKey,
} from '../class-authoring';
import { getKnownAbilityMechanics } from '@/features/combat/utils/class-abilities';

describe('validateNewClassKey', () => {
  it('accepts a fresh snake_case key', () => {
    expect(validateNewClassKey('warden', ['warrior'])).toEqual([]);
  });
  it('rejects duplicates and bad shapes', () => {
    expect(validateNewClassKey('warrior', ['warrior']).length).toBe(1);
    expect(validateNewClassKey('War den', []).length).toBe(1);
    expect(validateNewClassKey('ab', []).length).toBe(1);
  });
});

describe('role template', () => {
  it('is the canonical five-slot ladder', () => {
    expect(CLASS_ROLE_TEMPLATE.map(r => r.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(CLASS_ROLE_TEMPLATE.map(r => r.unlock_level)).toEqual([1, 5, 10, 15, 20]);
  });
});

describe('validateNewAbility', () => {
  const mechanics = getKnownAbilityMechanics();
  const base = {
    ability_key: 'shield_wall', label: 'Shield Wall', description: 'Brace behind your shield.', tooltip: '',
    mechanic_key: mechanics[0], cp_cost: 12, unlock_level: 10,
  };

  it('accepts a valid draft on a known mechanic', () => {
    expect(validateNewAbility(base, { existingKeys: [], knownMechanics: mechanics })).toEqual([]);
  });

  it('rejects unknown mechanics, duplicate keys and out-of-range values', () => {
    const errs = validateNewAbility(
      { ...base, mechanic_key: 'time_travel', cp_cost: -1, unlock_level: 99 },
      { existingKeys: ['shield_wall'], knownMechanics: mechanics },
    );
    expect(errs.length).toBe(4);
  });

  it('exposes only code-backed mechanics', () => {
    expect(mechanics.length).toBeGreaterThan(20);
    expect(mechanics).toContain('power_strike');
  });
});

describe('suggestAbilityKey', () => {
  it('snake-cases a label', () => {
    expect(suggestAbilityKey("Warden's Grasp!")).toBe('warden_s_grasp');
  });
});
