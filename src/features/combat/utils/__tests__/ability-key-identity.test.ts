/**
 * ability-key-identity.test.ts — checkpoint 1 guard for the ability-calculation
 * rework (docs/design/ability-calculation-rework.md).
 *
 * Asserts the verified audit shape (7 classes × 5 abilities = 35), that every
 * one of the 35 abilities resolves by its canonical `ability_key`, and that the
 * `class:tier` compat map agrees with the key-based registry so re-keying
 * changed no math.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { ABILITY_SEED } from '@/shared/config/ability-seed';
import {
  ABILITY_CALCS, getAbilityCalcs, getAbilityCalcsByKey, getAbilityKeyForSlot,
  resolveAmount, resolveAmountByKey, resolveDuration, resolveDurationByKey,
  resolveInterval, resolveIntervalByKey, buildCalcInputs,
  resetAbilityCalcRegistry, setAbilityCalcEntry,
} from '@/features/combat/utils/ability-calcs';

afterEach(() => resetAbilityCalcRegistry());

const CHAR = { level: 20, str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 };
const CLASSES = ['assassin', 'bard', 'healer', 'ranger', 'templar', 'warrior', 'wizard'];

describe('audit shape: 7 classes × 5 abilities = 35', () => {
  it('the seed covers exactly 35 abilities across 7 classes', () => {
    expect(ABILITY_SEED).toHaveLength(35);
    expect([...new Set(ABILITY_SEED.map(a => a.class_key))].sort()).toEqual(CLASSES);
    for (const classKey of CLASSES) {
      const slots = ABILITY_SEED.filter(a => a.class_key === classKey).map(a => a.slot).sort();
      expect(slots, classKey).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('every ability_key is unique and resolvable by key', () => {
    const keys = ABILITY_SEED.map(a => a.ability_key);
    expect(new Set(keys).size).toBe(35);
    for (const key of keys) {
      expect(getAbilityCalcsByKey(key), key).not.toBeNull();
      expect(getAbilityCalcsByKey(key)!.abilityKey).toBe(key);

    }
    expect(Object.keys(ABILITY_CALCS)).toHaveLength(35);
  });

  it('only the two mechanic-param-owned abilities have a null amount calc', () => {
    // Checkpoint 4 backfilled every other null. Holy Shield and Shield Wall
    // carry their magnitudes as named mechanic calcs (retaliation_damage,
    // block_chance / block_amount), so `amount_calc` stays null by design.
    const nulls = ABILITY_SEED.filter(a => !a.amount_calc).map(a => a.ability_key).sort();
    expect(nulls).toEqual(['holy_shield', 'shield_wall']);
    for (const key of nulls) {
      const row = ABILITY_SEED.find(a => a.ability_key === key)!;
      expect(Object.keys(row.mechanic_calcs ?? {}).length).toBeGreaterThan(0);
    }
  });
});

describe('class:tier compat map agrees with the key registry', () => {
  const inputs = buildCalcInputs(CHAR);

  it('maps every bar slot to the right ability and resolves identically', () => {
    for (const classKey of CLASSES) {
      for (let tier = 0; tier < 5; tier++) {
        const seeded = ABILITY_SEED.find(a => a.class_key === classKey && a.slot === tier)!;
        expect(getAbilityKeyForSlot(classKey, tier), `${classKey}:${tier}`)
          .toBe(seeded.ability_key);
        expect(getAbilityCalcs(classKey, tier)!.abilityKey).toBe(seeded.ability_key);

        expect(resolveAmount(classKey, tier, inputs, -1))
          .toBe(resolveAmountByKey(seeded.ability_key, inputs, -1));
        expect(resolveDuration(classKey, tier, inputs, -1))
          .toBe(resolveDurationByKey(seeded.ability_key, inputs, -1));
        expect(resolveInterval(classKey, tier, 0))
          .toBe(resolveIntervalByKey(seeded.ability_key, 0));
      }
    }
  });

  it('unknown class/tier falls back to the legacy value', () => {
    expect(resolveAmount('nonexistent', 0, inputs, 42)).toBe(42);
    expect(resolveAmountByKey('nonexistent_ability', inputs, 42)).toBe(42);
  });
});

describe('loadout swaps repoint the slot map', () => {
  it('stores the entry by ability_key and repoints class:tier', () => {
    setAbilityCalcEntry('wizard', 0, {
      abilityKey: 'frost_bolt',
      mechanicKey: 'fireball',
      amountCalc: { base: 123, terms: [], unit: 'damage' } as never,
      durationCalc: null,
      intervalMs: null,
      effectConfig: {},
      mechanicCalcs: {},

    });
    expect(getAbilityKeyForSlot('wizard', 0)).toBe('frost_bolt');
    expect(getAbilityCalcs('wizard', 0)!.abilityKey).toBe('frost_bolt');
    expect(resolveAmount('wizard', 0, buildCalcInputs(CHAR), -1)).toBe(123);
    expect(getAbilityCalcsByKey('fireball')!.abilityKey).toBe('fireball');
  });
});
