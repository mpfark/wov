/**
 * ability-calc-range.test.ts — bounded-random `duration_calc` ranges.
 *
 * Contract under test:
 *  - The evaluator NEVER generates randomness. All entropy arrives through
 *    `CalcInputs.random`.
 *  - Supplying `0` resolves the exact lower bound, `1` the exact upper bound.
 *  - The same supplied random input always produces the same result.
 *  - Fixed-duration abilities (no `range`) stay fixed regardless of injected
 *    randomness.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  evaluateCalc,
  resolveRange,
  calcUsesRange,
  validateCalc,
  describeCalc,
  type AbilityCalc,
  type CalcInputs,
} from '../ability-calc';
import { ABILITY_SEED } from '@/shared/config/ability-seed';

const ZERO_MODS = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };

function inputs(over: Partial<CalcInputs> = {}): CalcInputs {
  return { level: 10, mods: { ...ZERO_MODS }, ...over };
}

/** The 30–45 s variable poison/root duration, expressed as a bounded range. */
const VARIABLE_DURATION: AbilityCalc = {
  version: 2,
  base: 0,
  terms: [],
  range: { min: 30000, max: 45000 },
  unit: 'ms',
  note: 'variable 30–45s duration',
};

/** A fixed duration ability for contrast. */
const FIXED_DURATION: AbilityCalc = {
  version: 2,
  base: 25000,
  terms: [],
  unit: 'ms',
  note: 'fixed 25s duration',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bounded-random duration ranges', () => {
  it('resolves the exact lower boundary when the supplied random is 0', () => {
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ random: () => 0 }))).toBe(30000);
  });

  it('resolves the exact upper boundary when the supplied random is 1', () => {
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ random: () => 1 }))).toBe(45000);
  });

  it.each([
    [0.25, 33750],
    [0.5, 37500],
    [0.75, 41250],
    [0.1, 31500],
    [0.9, 43500],
  ])('resolves representative in-range value for random %s', (r, expected) => {
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ random: () => r }))).toBe(expected);
  });

  it('never resolves outside the declared bounds for any supplied input', () => {
    for (let i = 0; i <= 100; i++) {
      const value = evaluateCalc(VARIABLE_DURATION, inputs({ random: () => i / 100 }));
      expect(value).toBeGreaterThanOrEqual(30000);
      expect(value).toBeLessThanOrEqual(45000);
    }
  });

  it('clamps out-of-contract supplied randomness into the bounds', () => {
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ random: () => -5 }))).toBe(30000);
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ random: () => 7 }))).toBe(45000);
    // Non-finite input degrades to the deterministic midpoint, never NaN.
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ random: () => NaN }))).toBe(37500);
  });

  it('is deterministic: the same supplied random input yields the same result', () => {
    const runs = Array.from({ length: 10 }, () =>
      evaluateCalc(VARIABLE_DURATION, inputs({ random: () => 0.37 })),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it('reproduces an identical sequence from an identical seeded source', () => {
    const seeded = () => {
      let state = 42;
      return () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
    };
    const a = Array.from({ length: 8 }, (_, _i) => 0);
    const srcA = seeded();
    const srcB = seeded();
    const runA = a.map(() => evaluateCalc(VARIABLE_DURATION, inputs({ random: srcA })));
    const runB = a.map(() => evaluateCalc(VARIABLE_DURATION, inputs({ random: srcB })));
    expect(runA).toEqual(runB);
  });

  it('never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    evaluateCalc(VARIABLE_DURATION, inputs());
    evaluateCalc(VARIABLE_DURATION, inputs({ random: () => 0.5 }));
    evaluateCalc(VARIABLE_DURATION, inputs({ rangeMode: 'max' }));
    resolveRange({ min: 1, max: 9 }, inputs());
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves deterministically without an injected source', () => {
    expect(evaluateCalc(VARIABLE_DURATION, inputs())).toBe(37500);
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ rangeMode: 'min' }))).toBe(30000);
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ rangeMode: 'max' }))).toBe(45000);
    expect(evaluateCalc(VARIABLE_DURATION, inputs({ rangeMode: 'mid' }))).toBe(37500);
  });

  it('composes with base, stat terms and caps', () => {
    const calc: AbilityCalc = {
      version: 2,
      base: 1000,
      terms: [{ source: 'stat', stat: 'wis', mult: 500, clampAtZero: true }],
      range: { min: 0, max: 4000 },
      cap: 6000,
      rounding: 'floor',
      unit: 'ms',
    };
    const wis = { ...ZERO_MODS, wis: 4 };
    expect(evaluateCalc(calc, { level: 10, mods: wis, random: () => 0 })).toBe(3000);
    expect(evaluateCalc(calc, { level: 10, mods: wis, random: () => 1 })).toBe(6000); // capped
    expect(evaluateCalc(calc, { level: 10, mods: wis, random: () => 0.5 })).toBe(5000);
  });

  it('honours per-range rounding', () => {
    const calc: AbilityCalc = {
      base: 0, terms: [], range: { min: 0, max: 3, rounding: 'floor' }, unit: 'ms',
    };
    expect(evaluateCalc(calc, inputs({ random: () => 0.5 }))).toBe(1);
  });

  it('treats a degenerate range (min === max) as fixed', () => {
    const calc: AbilityCalc = { base: 0, terms: [], range: { min: 12000, max: 12000 }, unit: 'ms' };
    expect(evaluateCalc(calc, inputs({ random: () => 0 }))).toBe(12000);
    expect(evaluateCalc(calc, inputs({ random: () => 1 }))).toBe(12000);
    expect(calcUsesRange(calc)).toBe(false);
  });
});

describe('fixed durations stay fixed', () => {
  it('ignores injected randomness entirely', () => {
    for (const r of [0, 0.13, 0.5, 0.87, 1]) {
      expect(evaluateCalc(FIXED_DURATION, inputs({ random: () => r }))).toBe(25000);
    }
    expect(evaluateCalc(FIXED_DURATION, inputs({ rangeMode: 'min' }))).toBe(25000);
    expect(evaluateCalc(FIXED_DURATION, inputs({ rangeMode: 'max' }))).toBe(25000);
  });

  it('reports calcUsesRange === false', () => {
    expect(calcUsesRange(FIXED_DURATION)).toBe(false);
    expect(calcUsesRange(VARIABLE_DURATION)).toBe(true);
  });

  it('every seeded duration_calc today is randomness-independent', () => {
    // No shipped ability opts into bounded randomness yet: this pass added the
    // capability without changing gameplay values. If a future ability opts in,
    // add it to the allowlist deliberately.
    const withRange = ABILITY_SEED
      .filter(a => a.duration_calc && calcUsesRange(a.duration_calc))
      .map(a => a.ability_key);
    expect(withRange).toEqual([]);

    for (const ability of ABILITY_SEED) {
      if (!ability.duration_calc) continue;
      const low = evaluateCalc(ability.duration_calc, inputs({ random: () => 0 }));
      const high = evaluateCalc(ability.duration_calc, inputs({ random: () => 1 }));
      expect(low).toBe(high);
    }
  });
});

describe('range validation and description', () => {
  it('accepts a well-formed range', () => {
    expect(validateCalc(VARIABLE_DURATION)).toEqual([]);
  });

  it('rejects min above max', () => {
    expect(validateCalc({ base: 0, terms: [], range: { min: 9, max: 1 }, unit: 'ms' }))
      .toContain('range.min cannot exceed range.max');
  });

  it('rejects non-finite bounds', () => {
    const errors = validateCalc({
      base: 0, terms: [], range: { min: NaN, max: Infinity }, unit: 'ms',
    });
    expect(errors).toContain('range.min must be a finite number');
    expect(errors).toContain('range.max must be a finite number');
  });

  it('describes the range for the admin preview', () => {
    expect(describeCalc(VARIABLE_DURATION)).toContain('random(30000–45000)');
    expect(describeCalc(FIXED_DURATION)).not.toContain('random(');
  });
});
