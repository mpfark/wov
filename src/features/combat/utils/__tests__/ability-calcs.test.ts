/**
 * ability-calcs.test.ts — Phase 2c guards for the configurable magnitude registry.
 *
 * 1. Every ability on a class bar has a registry entry (so `resolveAmount`
 *    always knows which calc belongs to which bar slot).
 * 2. The seeded fallback resolves to the same numbers the legacy inline
 *    formulas produce (spot-checked against the original expressions).
 * 3. Configured rows override the seed, and a reset restores it.
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  ABILITY_CALCS, getAbilityCalcs, resolveAmount, resolveDuration, resolveInterval,
  setAbilityCalcRegistry, resetAbilityCalcRegistry, isAbilityCalcRegistryLoaded,
  buildCalcInputs, type AbilityCalcConfigRow,
} from '@/features/combat/utils/ability-calcs';
import { CLASS_ABILITIES } from '@/features/combat/utils/class-abilities';
import { getStatModifier } from '@/shared/formulas/stats';

afterEach(() => resetAbilityCalcRegistry());

const CHAR = { level: 20, str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 };

describe('ability calc registry coverage', () => {
  it('has an entry for every class bar slot', () => {
    for (const [classKey, list] of Object.entries(CLASS_ABILITIES)) {
      list.forEach((ability, tier) => {
        const entry = getAbilityCalcs(classKey, tier);
        expect(entry, `${classKey}:${tier}`).not.toBeNull();
        expect(entry!.mechanicKey).toBe(ability.type);
      });
    }
  });

  it('starts unloaded on the seeded fallback', () => {
    expect(isAbilityCalcRegistryLoaded()).toBe(false);
    expect(Object.keys(ABILITY_CALCS).length).toBeGreaterThan(30);
  });
});

describe('seeded magnitudes match the legacy inline math', () => {
  const inputs = buildCalcInputs(CHAR);
  const mod = getStatModifier(18);

  it('Second Wind heal (warrior slot 1) = max(3, CON×3 + level)', () => {
    expect(resolveAmount('warrior', 1, inputs, -1))
      .toBe(Math.max(3, mod * 3 + CHAR.level));
  });

  it('Heal (healer slot 1) = max(3, WIS×3 + level)', () => {
    expect(resolveAmount('healer', 1, inputs, -1))
      .toBe(Math.max(3, mod * 3 + CHAR.level));
  });

  it('Transfer Health (healer slot 2) = max(3, WIS×2 + floor(level/2))', () => {
    expect(resolveAmount('healer', 2, inputs, -1))
      .toBe(Math.max(3, mod * 2 + Math.floor(CHAR.level / 2)));
  });

  it('Rend duration (warrior slot 3) = min(30000, 20000 + DEX×1000)', () => {
    expect(resolveDuration('warrior', 3, inputs, -1))
      .toBe(Math.min(30000, 20000 + Math.max(0, mod) * 1000));
    expect(resolveInterval('warrior', 3, 0)).toBe(2000);
  });

  it('Divine Aegis shield (healer slot 4) = WIS×2 + floor(level×0.7)', () => {
    expect(resolveAmount('healer', 4, inputs, -1))
      .toBe(mod * 2 + Math.floor(CHAR.level * 0.7));
  });

  it('Crescendo (bard slot 3) scales with CHA, Purifying Light with WIS', () => {
    const skewed = buildCalcInputs({ ...CHAR, cha: 20, wis: 10 });
    expect(resolveAmount('bard', 3, skewed, -1))
      .toBe(Math.max(1, getStatModifier(20) + 2));
    expect(resolveAmount('healer', 3, skewed, -1))
      .toBe(Math.max(1, getStatModifier(10) + 2));
  });
});

describe('configured overrides', () => {
  const row = (overrides: Partial<AbilityCalcConfigRow['ability']> = {}): AbilityCalcConfigRow => ({
    class_key: 'warrior',
    is_default: true,
    status: 'active',
    role: { slot: 1 },
    ability: {
      ability_key: 'second_wind',
      mechanic_key: 'self_heal',
      status: 'active',
      amount_calc: { base: 99, terms: [], unit: 'hp' },
      duration_calc: null,
      interval_ms: 1234,
      effect_config: {},
      ...overrides,
    } as AbilityCalcConfigRow['ability'],
  });

  it('applies configured calcs over the seed', () => {
    setAbilityCalcRegistry([row()]);
    expect(isAbilityCalcRegistryLoaded()).toBe(true);
    expect(resolveAmount('warrior', 0, buildCalcInputs(CHAR), -1)).toBe(99);
    expect(resolveInterval('warrior', 0, 0)).toBe(1234);
  });

  it('ignores inactive and non-default rows', () => {
    const seeded = resolveAmount('warrior', 1, buildCalcInputs(CHAR), -1);
    setAbilityCalcRegistry([{ ...row(), status: 'draft' }]);
    expect(resolveAmount('warrior', 1, buildCalcInputs(CHAR), -1)).toBe(seeded);
    setAbilityCalcRegistry([{ ...row(), is_default: false }]);
    expect(resolveAmount('warrior', 1, buildCalcInputs(CHAR), -1)).toBe(seeded);
  });

  it('falls back to the legacy value when no calc is configured', () => {
    // power_strike (warrior slot 0) is weapon-die owned: amount_calc is null.
    expect(resolveAmount('warrior', 0, buildCalcInputs(CHAR), 77)).toBe(77);
  });

  it('reset restores the seeded entries', () => {
    const seeded = resolveAmount('warrior', 1, buildCalcInputs(CHAR), -1);
    setAbilityCalcRegistry([row()]);
    resetAbilityCalcRegistry();
    expect(isAbilityCalcRegistryLoaded()).toBe(false);
    expect(resolveAmount('warrior', 1, buildCalcInputs(CHAR), -1)).toBe(seeded);
  });
});
