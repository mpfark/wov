/**
 * ability-calc-v2.test.ts — checkpoint 3 coverage for the extended evaluator.
 *
 * Pins: dice terms (seeded + deterministic modes), weapon-die resolution,
 * context (stack) terms, nested multiplier calcs, evaluation order, validation
 * rejections, and the mechanic-template registry contract.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCalc,
  validateCalc,
  describeCalc,
  resolveDieSides,
  calcUsesDice,
  type AbilityCalc,
  type CalcInputs,
} from '../ability-calc';
import {
  MECHANIC_TEMPLATES,
  getMechanicTemplate,
  validateMechanicCalcs,
  validateAbilityForPublish,
  STACK_EFFECT_TYPE,
} from '@/shared/config/mechanic-templates';

const mods = { str: 5, dex: 4, con: 3, int: 6, wis: 2, cha: 1 };
const inputs = (over: Partial<CalcInputs> = {}): CalcInputs => ({ level: 20, mods, ...over });

/** Deterministic roller: always the top face. */
const maxRoll = (sides: number) => sides;

describe('dice terms', () => {
  const calc: AbilityCalc = {
    version: 2, base: 0, unit: 'hp',
    terms: [
      { source: 'dice', count: 2, die: 'weapon_main', fallbackDie: 4 },
      { source: 'stat', stat: 'str' },
    ],
  };

  it('uses the equipped weapon die with an injected roller', () => {
    expect(evaluateCalc(calc, inputs({ weaponDie: 8, roll: maxRoll }))).toBe(16 + 5);
  });

  it('falls back to the unarmed die when no weapon is equipped', () => {
    expect(evaluateCalc(calc, inputs({ weaponDie: null, roll: maxRoll }))).toBe(8 + 5);
  });

  it('is deterministic without a roller (average / min / max)', () => {
    expect(evaluateCalc(calc, inputs({ weaponDie: 8 }))).toBe(9 + 5);
    expect(evaluateCalc(calc, inputs({ weaponDie: 8, diceMode: 'min' }))).toBe(2 + 5);
    expect(evaluateCalc(calc, inputs({ weaponDie: 8, diceMode: 'max' }))).toBe(16 + 5);
  });

  it('resolves fixed dice types and reports dice usage', () => {
    expect(resolveDieSides({ source: 'dice', die: 'd12' }, inputs())).toBe(12);
    expect(calcUsesDice(calc)).toBe(true);
    expect(calcUsesDice({ base: 1, terms: [], unit: 'hp' })).toBe(false);
  });

  it('never calls Math.random', () => {
    const original = Math.random;
    Math.random = () => { throw new Error('evaluator must not roll on its own'); };
    try {
      expect(() => evaluateCalc(calc, inputs({ weaponDie: 6 }))).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

describe('context terms', () => {
  const calc: AbilityCalc = {
    version: 2, base: 10, unit: 'hp',
    terms: [{ source: 'context', contextKey: 'consumed_stacks', mult: 3 }],
  };

  it('reads allowlisted runtime context', () => {
    expect(evaluateCalc(calc, inputs({ context: { consumed_stacks: 4 } }))).toBe(22);
  });

  it('treats a missing context value as zero and clamps negatives', () => {
    expect(evaluateCalc(calc, inputs())).toBe(10);
    expect(evaluateCalc(calc, inputs({ context: { consumed_stacks: -5 } }))).toBe(10);
  });
});

describe('evaluation order', () => {
  it('applies base+terms, then finalMult, then multiplierCalc, then rounding and clamps', () => {
    const calc: AbilityCalc = {
      version: 2, base: 10, unit: 'hp',
      terms: [{ source: 'stat', stat: 'str' }], // 15
      finalMult: 0.8,                            // 12
      multiplierCalc: {
        base: 1, unit: 'multiplier',
        terms: [{ source: 'context', contextKey: 'active_stacks', mult: 0.25 }],
      },
      rounding: 'floor',
      cap: 100,
    };
    // 15 * 0.8 = 12; multiplier = 1 + 2*0.25 = 1.5 -> 18
    expect(evaluateCalc(calc, inputs({ context: { active_stacks: 2 } }))).toBe(18);
  });

  it('honours finalMult over the legacy postMult spelling', () => {
    const calc: AbilityCalc = { base: 10, terms: [], unit: 'hp', postMult: 2, finalMult: 3 };
    expect(evaluateCalc(calc, inputs())).toBe(30);
  });

  it('keeps v1 records identical (postMult then rounding)', () => {
    const v1: AbilityCalc = {
      base: 0, unit: 'ms', rounding: 'floor', postMult: 1000,
      terms: [{ source: 'stat', stat: 'wis', mult: 1.5 }],
    };
    expect(evaluateCalc(v1, inputs())).toBe(3000);
  });
});

describe('validateCalc', () => {
  it('accepts a well-formed v2 calc', () => {
    expect(validateCalc({
      version: 2, base: 0, unit: 'hp',
      terms: [{ source: 'dice', count: 1, die: 'weapon_main', fallbackDie: 4 }],
    })).toEqual([]);
  });

  it('rejects unknown sources, dice and context keys', () => {
    const errors = validateCalc({
      base: 0, unit: 'hp',
      terms: [
        // @ts-expect-error intentional bad source
        { source: 'wizardry' },
        // @ts-expect-error intentional bad die
        { source: 'dice', die: 'd7' },
        // @ts-expect-error intentional bad context key
        { source: 'context', contextKey: 'gold' },
      ],
    });
    expect(errors.some(e => e.includes('unknown source'))).toBe(true);
    expect(errors.some(e => e.includes('unknown die'))).toBe(true);
    expect(errors.some(e => e.includes('unknown context key'))).toBe(true);
  });

  it('rejects out-of-range dice counts and double multiplier spellings', () => {
    expect(validateCalc({
      base: 0, unit: 'hp', terms: [{ source: 'dice', count: 99, die: 'd6' }],
    }).some(e => e.includes('dice count'))).toBe(true);
    expect(validateCalc({
      base: 0, unit: 'hp', terms: [], postMult: 2, finalMult: 2,
    }).some(e => e.includes('legacy spelling'))).toBe(true);
  });

  it('validates nested multiplier calcs', () => {
    const errors = validateCalc({
      base: 0, unit: 'hp', terms: [],
      multiplierCalc: { base: 1, unit: 'multiplier', terms: [{ source: 'stat' }] },
    });
    expect(errors.some(e => e.startsWith('multiplierCalc:'))).toBe(true);
  });

  it('describes dice and multiplier calcs for the admin preview', () => {
    const text = describeCalc({
      base: 0, unit: 'hp',
      terms: [{ source: 'dice', count: 2, die: 'd6' }],
      multiplierCalc: { base: 1, unit: 'multiplier', terms: [] },
    });
    expect(text).toContain('d6');
    expect(text).toContain('×');
  });
});

describe('mechanic templates', () => {
  it('exposes unique mechanic keys with unique param keys', () => {
    const keys = MECHANIC_TEMPLATES.map(m => m.mechanicKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const template of MECHANIC_TEMPLATES) {
      const params = template.params.map(p => p.key);
      expect(new Set(params).size).toBe(params.length);
    }
  });

  it('declares the mechanics that own named tunables', () => {
    expect(getMechanicTemplate('multi_attack')?.params.map(p => p.key)).toContain('arrow_count');
    expect(getMechanicTemplate('poison_buff')?.params.map(p => p.key)).toContain('max_stacks');
    expect(getMechanicTemplate('hp_transfer')?.params.map(p => p.key)).toContain('reserve_hp');
    // Fully-wired policy: mechanics whose only magnitude is `amount_calc` expose
    // no duplicate named knob.
    expect(getMechanicTemplate('spell_attack')?.params).toEqual([]);
    expect(getMechanicTemplate('spell_attack')?.requiresAmount).toBe(true);

    expect(getMechanicTemplate('stack_consume')?.requiresStackOp).toEqual({
      stackType: 'poison_stacks', op: 'consume_all', timing: 'on_commit', owner: 'target',
    });
    expect(STACK_EFFECT_TYPE.poison_stacks).toBe('poison');
    expect(STACK_EFFECT_TYPE.burn_stacks).toBe('ignite');
  });

  it('rejects unknown params and missing required params', () => {
    const count: AbilityCalc = { base: 3, terms: [], unit: 'count' };
    expect(validateMechanicCalcs('multi_attack', { arrow_count: count })).toEqual([]);
    expect(validateMechanicCalcs('multi_attack', {})).toEqual([
      'mechanic_calcs.arrow_count is required for mechanic "multi_attack"',
    ]);
    expect(validateMechanicCalcs('heal', { arrow_count: count })[0]).toContain('not a parameter');
    expect(validateMechanicCalcs('nope', {})[0]).toContain('unknown mechanic key');
  });

  it('gates publishing on every calc in the row', () => {
    expect(validateAbilityForPublish({
      mechanic_key: 'heal',
      amount_calc: { base: 5, terms: [{ source: 'stat', stat: 'wis' }], unit: 'hp' },
      duration_calc: null,
      mechanic_calcs: null,
    })).toEqual([]);

    const errors = validateAbilityForPublish({
      mechanic_key: 'multi_attack',
      amount_calc: { base: Number.NaN, terms: [], unit: 'hp' },
      mechanic_calcs: {},
    });
    expect(errors.some(e => e.startsWith('amount_calc:'))).toBe(true);
    expect(errors.some(e => e.includes('arrow_count is required'))).toBe(true);
  });
});
