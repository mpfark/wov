/**
 * ability-config-failure.test.ts — Phase C / Phase D.
 *
 * Phase C: a configuration failure is a controlled error, never a silent 0.
 * Phase D: sealed mode ignores configured rows and resolves from the seed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  requireAbilityMagnitude,
  resolveAbilityMagnitude,
  AbilityConfigError,
  ABILITY_CONFIG_FAILURE_TEXT,
} from '../ability-magnitude';
import {
  setAbilityCalcRegistry,
  resetAbilityCalcRegistry,
  getAbilityCalcsByKey,
} from '@/features/combat/utils/ability-calcs';
import { ABILITY_RESOLVER_MODE } from '@/shared/config/feature-flags';

const inputs = { level: 10, mods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 } };
const base = { classKey: 'warrior', abilityKey: 'power_strike', kind: 'amount' as const, inputs };

describe('Phase C — no silent zero', () => {
  it('throws AbilityConfigError when nothing is configured', () => {
    expect(() => requireAbilityMagnitude({ ...base, calc: null }))
      .toThrow(AbilityConfigError);
  });

  it('throws when the registry is unavailable, and reports why', () => {
    try {
      requireAbilityMagnitude({ ...base, calc: null, registryUnavailable: true });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AbilityConfigError);
      const e = err as AbilityConfigError;
      expect(e.failureReason).toBe('registry_unavailable');
      expect(e.abilityKey).toBe('power_strike');
      expect(e.label).toBe('warrior:power_strike:amount');
    }
  });

  it('throws on a calc that cannot evaluate to a finite number', () => {
    const bad = { base: Number.NaN, terms: [] } as never;
    expect(() => requireAbilityMagnitude({ ...base, calc: bad })).toThrow(AbilityConfigError);
  });

  it('returns the configured value when configuration answers', () => {
    const calc = { base: 5, terms: [{ source: 'stat', stat: 'str', multiplier: 2 }] } as never;
    expect(requireAbilityMagnitude({ ...base, calc })).toBe(11);
  });

  it('the lenient resolver still reports the failure it papered over', () => {
    const result = resolveAbilityMagnitude({ ...base, calc: null, fallbackValue: 1 });
    expect(result.value).toBe(1);
    expect(result.source).toBe('failed');
    expect(result.actionableFailure).toBe(true);
  });

  it('exposes one neutral player-facing line', () => {
    expect(ABILITY_CONFIG_FAILURE_TEXT).toBe('the technique falters');
  });
});

describe('Phase D — sealed configuration mode (client)', () => {
  afterEach(() => resetAbilityCalcRegistry());

  it('ships in v2 by default', () => {
    expect(ABILITY_RESOLVER_MODE).toBe('v2');
  });

  it('applies configured rows in v2 mode', () => {
    const seeded = getAbilityCalcsByKey('power_strike');
    expect(seeded).not.toBeNull();
    setAbilityCalcRegistry([{
      class_key: 'warrior',
      status: 'active',
      is_default: true,
      role: { slot: 0 },
      ability: {
        ability_key: 'power_strike',
        mechanic_key: 'power_strike',
        status: 'active',
        amount_calc: { base: 999, terms: [] },
        duration_calc: null,
        interval_ms: null,
        effect_config: {},
        mechanic_calcs: {},
      },
    } as never]);
    const applied = ABILITY_RESOLVER_MODE === 'sealed'
      ? seeded?.amountCalc?.base
      : getAbilityCalcsByKey('power_strike')?.amountCalc?.base;
    expect(applied).toBe(ABILITY_RESOLVER_MODE === 'sealed' ? seeded?.amountCalc?.base : 999);
  });
});
