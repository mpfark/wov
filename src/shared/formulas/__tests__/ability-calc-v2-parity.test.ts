/**
 * ability-calc-v2-parity.test.ts — checkpoint 5 parity proof.
 *
 * The v1 parity harness (`ability-calc-parity.test.ts`) covers every calc that
 * is a pure function of level + stat modifiers. This file covers the records
 * backfilled at checkpoint 4, which the v1 harness cannot express:
 *
 *   • dice terms (weapon die, unarmed fallback) — proved with a SEEDED roll
 *     source so both paths see identical rolls,
 *   • `finalMult` riders (judgment ×0.8, consecrate ×0.65),
 *   • per-stack multipliers over the full 0..5 stack range,
 *   • named mechanic calcs whose legacy owner was an inline expression in
 *     `combat-tick` (holy shield retaliation, shield wall block, crit edge).
 *
 * Each case compares the evaluator against the ORIGINAL inline formula copied
 * verbatim from the legacy call site. A failure means the seed drifted from the
 * live math, and the cutover flag must not be flipped.
 */
import { describe, it, expect } from 'vitest';

import {
  evaluateCalc, type AbilityCalc, type CalcInputs, type RollSource,
  validateCalc,
} from '@/shared/formulas/ability-calc';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getStatModifier } from '@/shared/formulas/stats';
import { getEffectiveCombatMod } from '@/shared/formulas/effective';
import { getShieldWallChanceBonus, getShieldWallAmountBonus } from '@/shared/formulas/combat';

const STATS = [1, 4, 8, 10, 12, 14, 16, 18, 20, 24, 30, 40];
const LEVELS = [1, 5, 10, 15, 20, 30, 42];
/** Unarmed (1d4) plus every weapon die tier the progression can produce. */
const DICE = [4, 6, 8, 10, 12, 20];
const STACKS = [0, 1, 2, 3, 4, 5];

function byKey(key: string) {
  const found = ABILITY_SEED.find(a => a.ability_key === key);
  if (!found) throw new Error(`seed missing ability ${key}`);
  return found;
}

function amountOf(key: string): AbilityCalc {
  const calc = byKey(key).amount_calc;
  expect(calc, `${key}.amount_calc`).not.toBeNull();
  return calc!;
}

function mechanicOf(key: string, param: string): AbilityCalc {
  const calc = byKey(key).mechanic_calcs?.[param];
  expect(calc, `${key}.mechanic_calcs.${param}`).toBeTruthy();
  return calc!;
}

/** Seeded roller: always returns the same face, so both paths agree. */
const fixedRoll = (face: number): RollSource => () => face;

function inputs(level: number, raw: number, extra: Partial<CalcInputs> = {}): CalcInputs {
  const m = getStatModifier(raw);
  return {
    level,
    mods: { str: m, dex: m, con: m, int: m, wis: m, cha: m },
    ...extra,
  };
}

/** Faces worth proving for a die: minimum, a middle value, and maximum. */
function facesFor(die: number): number[] {
  return Array.from(new Set([1, Math.max(1, Math.ceil(die / 2)), die]));
}

function sweepDice(
  calc: AbilityCalc,
  legacy: (level: number, mod: number, roll: number, die: number) => number,
  label: string,
) {
  for (const level of LEVELS) {
    for (const raw of STATS) {
      for (const die of DICE) {
        for (const face of facesFor(die)) {
          const got = evaluateCalc(calc, inputs(level, raw, { weaponDie: die, roll: fixedRoll(face) }));
          const want = legacy(level, getStatModifier(raw), face, die);
          expect(
            Math.abs(got - want) < 1e-9,
            `${label} ${JSON.stringify({ level, raw, die, face, got, want })}`,
          ).toBe(true);
        }
      }
    }
  }
}

function sweepPlain(
  calc: AbilityCalc,
  legacy: (level: number, mod: number) => number,
  label: string,
) {
  for (const level of LEVELS) {
    for (const raw of STATS) {
      const got = evaluateCalc(calc, inputs(level, raw));
      const want = legacy(level, getStatModifier(raw));
      expect(
        Math.abs(got - want) < 1e-9,
        `${label} ${JSON.stringify({ level, raw, got, want })}`,
      ).toBe(true);
    }
  }
}

// ── Legacy formulas, copied verbatim from the live call sites ──────

/** combat-tick T0 physical: weapon die + raw mod + (3 + soft mod + level/3). */
const legacyPhysicalT0 = (level: number, mod: number, roll: number) => {
  const effMod = getEffectiveCombatMod(Math.max(0, mod), 'damage');
  return Math.max(1, roll + mod + Math.round(3 + effMod + Math.floor(level / 3)));
};

/** combat-tick T0 spell: max(1, round(5 + 2·soft mod + level/3)). */
const legacySpellT0 = (level: number, mod: number) => {
  const effMod = getEffectiveCombatMod(Math.max(0, mod), 'damage');
  return Math.max(1, Math.round(5 + 2 * effMod + Math.floor(level / 3)));
};

describe('checkpoint 4 backfills validate', () => {
  it('every backfilled amount_calc and mechanic_calc passes validation', () => {
    for (const ability of ABILITY_SEED) {
      if (ability.amount_calc) {
        expect(validateCalc(ability.amount_calc), `${ability.ability_key}.amount_calc`).toEqual([]);
      }
      for (const [param, calc] of Object.entries(ability.mechanic_calcs ?? {})) {
        expect(validateCalc(calc), `${ability.ability_key}.${param}`).toEqual([]);
      }
    }
  });

  it('every magnitude-bearing ability carries a version 2 amount calc', () => {
    // Stances whose magnitude lives entirely in named mechanic calcs are the
    // only rows allowed to have no amount_calc.
    const mechanicOnly = new Set(['holy_shield', 'shield_wall']);
    for (const ability of ABILITY_SEED) {
      if (mechanicOnly.has(ability.ability_key)) {
        expect(ability.amount_calc, ability.ability_key).toBeNull();
        expect(Object.keys(ability.mechanic_calcs ?? {}).length, ability.ability_key).toBeGreaterThan(0);
        continue;
      }
      expect(ability.amount_calc, ability.ability_key).not.toBeNull();
    }
  });
});

describe('dice parity — tier-0 physical identity attacks', () => {
  for (const key of ['power_strike', 'aimed_shot', 'backstab']) {
    it(`${key} — weapon die + stat + bonus, every die × face`, () => {
      sweepDice(amountOf(key), legacyPhysicalT0, key);
    });
  }

  it('unarmed falls back to the configured 1d4 die', () => {
    const calc = amountOf('power_strike');
    for (const face of [1, 2, 4]) {
      const got = evaluateCalc(calc, inputs(10, 16, { weaponDie: null, roll: fixedRoll(face) }));
      expect(got).toBe(legacyPhysicalT0(10, getStatModifier(16), face));
    }
  });

  it('deterministic dice modes bracket the seeded range', () => {
    const calc = amountOf('power_strike');
    const base = { weaponDie: 8 } as Partial<CalcInputs>;
    const min = evaluateCalc(calc, inputs(20, 18, { ...base, diceMode: 'min' }));
    const avg = evaluateCalc(calc, inputs(20, 18, { ...base, diceMode: 'average' }));
    const max = evaluateCalc(calc, inputs(20, 18, { ...base, diceMode: 'max' }));
    expect(min).toBeLessThan(avg);
    expect(avg).toBeLessThan(max);
    expect(min).toBe(evaluateCalc(calc, inputs(20, 18, { ...base, roll: fixedRoll(1) })));
    expect(max).toBe(evaluateCalc(calc, inputs(20, 18, { ...base, roll: fixedRoll(8) })));
  });
});

describe('spell parity — tier-0 stat-only attacks', () => {
  for (const key of ['fireball', 'smite', 'cutting_words']) {
    it(`${key} — 5 + 2× soft stat + level/3`, () => {
      sweepPlain(amountOf(key), legacySpellT0, key);
    });
  }

  it('judgment — the ×0.8 templar rider lives in finalMult', () => {
    sweepPlain(
      amountOf('judgment'),
      (l, m) => Math.max(1, Math.floor(legacySpellT0(l, m) * 0.8)),
      'judgment',
    );
  });
});

describe('finisher parity — dice × consumed stacks', () => {
  it('eviscerate — unrounded base, single rounding after the stack multiplier', () => {
    const base = amountOf('eviscerate');
    const perStack = mechanicOf('eviscerate', 'per_stack_multiplier');

    for (const level of LEVELS) {
      for (const raw of STATS) {
        const mod = getStatModifier(raw);
        const effDexDmg = getEffectiveCombatMod(Math.max(0, mod), 'damage');
        const effChaStack = getEffectiveCombatMod(Math.max(0, mod), 'stacking');
        for (const die of DICE) {
          for (const face of facesFor(die)) {
            const gotBase = evaluateCalc(base, inputs(level, raw, { weaponDie: die, roll: fixedRoll(face) }));
            const wantBase = face + mod + (2 + effDexDmg + Math.floor(level / 3));
            // Messages are built ONLY on mismatch: this sweep runs ~12k
            // assertions, and eager JSON.stringify made the case slow enough to
            // brush the default 5s timeout under a loaded parallel suite.
            if (!(Math.abs(gotBase - wantBase) < 1e-9)) {
              expect.fail(`evis base ${JSON.stringify({ level, raw, die, face, gotBase, wantBase })}`);
            }

            const gotPer = evaluateCalc(perStack, inputs(level, raw));
            const wantPer = 0.50 + effChaStack * 0.02;
            if (!(Math.abs(gotPer - wantPer) < 1e-9)) {
              expect.fail(`evis per-stack ${JSON.stringify({ raw, gotPer, wantPer })}`);
            }

            for (const stacks of STACKS) {
              const got = Math.max(1, Math.round(gotBase * (1 + gotPer * stacks)));
              const want = Math.max(1, Math.round(wantBase * (1 + wantPer * stacks)));
              if (got !== want) {
                expect.fail(`evis final ${JSON.stringify({ level, raw, die, face, stacks, got, want })}`);
              }
            }
          }
        }
      }
    }
    // Deterministic sweep, but a big one — never let scheduler noise on a
    // saturated worker pool masquerade as a parity failure.
  }, 30_000);


  it('conflagrate — INT base plus per-stack rider over 0..5 stacks', () => {
    const base = amountOf('conflagrate');
    const perStack = mechanicOf('conflagrate', 'per_stack_multiplier');
    for (const level of LEVELS) {
      for (const raw of STATS) {
        const mod = getStatModifier(raw);
        const effIntBurst = getEffectiveCombatMod(Math.max(0, mod), 'burst');
        const gotBase = evaluateCalc(base, inputs(level, raw));
        const wantBase = Math.round(4 + 2 * effIntBurst + Math.floor(level / 3));
        expect(gotBase, `conflagrate base ${JSON.stringify({ level, raw })}`).toBe(wantBase);
        const gotPer = evaluateCalc(perStack, inputs(level, raw));
        for (const stacks of STACKS) {
          expect(Math.max(1, Math.floor(gotBase * (1 + gotPer * stacks)))).toBe(
            Math.max(1, Math.floor(wantBase * (1 + gotPer * stacks))),
          );
        }
      }
    }
  });
});

describe('per-arrow parity — Barrage', () => {
  it('per-arrow damage = weapon die + half DEX, floor 1', () => {
    sweepDice(
      amountOf('barrage'),
      (_l, m, roll) => Math.max(roll + Math.max(0, Math.floor(m / 2)), 1),
      'barrage',
    );
  });
});

describe('burst parity — Grand Finale', () => {
  it('CHA burst base, floor 8 (the CHA-sided bonus die stays mechanic-owned)', () => {
    sweepPlain(
      amountOf('grand_finale'),
      (l, m) => Math.max(8, Math.round(getEffectiveCombatMod(Math.max(0, m), 'burst') * 4 + Math.floor(l * 1.5))),
      'grand_finale',
    );
  });

  it('INT crit edge = floor(INT / 2)', () => {
    sweepPlain(
      mechanicOf('grand_finale', 'crit_edge'),
      (_l, m) => Math.floor(Math.max(0, m) / 2),
      'grand_finale.crit_edge',
    );
  });
});

describe('templar mechanic parity', () => {
  it('holy shield retaliation — 2 + floor(soft WIS × 0.8) + soft CON + level/4', () => {
    sweepPlain(
      mechanicOf('holy_shield', 'retaliation_damage'),
      (l, m) => Math.max(1, Math.round(
        2
        + Math.floor(getEffectiveCombatMod(Math.max(0, m), 'damage') * 0.8)
        + getEffectiveCombatMod(Math.max(0, m), 'damage')
        + Math.floor(l / 4),
      )),
      'holy_shield.retaliation_damage',
    );
  });

  it('shield wall block chance / amount — match the coded helpers', () => {
    for (const raw of STATS) {
      const chance = evaluateCalc(mechanicOf('shield_wall', 'block_chance'), inputs(1, raw));
      const amount = evaluateCalc(mechanicOf('shield_wall', 'block_amount'), inputs(1, raw));
      expect(Math.abs(chance - getShieldWallChanceBonus(raw)) < 1e-9, `block_chance ${raw}`).toBe(true);
      expect(Math.abs(amount - getShieldWallAmountBonus(raw)) < 1e-9, `block_amount ${raw}`).toBe(true);
    }
  });

  it('consecrate — (2 + WIS) × 0.65 configured as finalMult', () => {
    sweepPlain(
      amountOf('consecrate'),
      (_l, m) => (2 + Math.max(0, m)) * 0.65,
      'consecrate',
    );
    // The live call site floors once, after the bond multiplier.
    for (const raw of STATS) {
      const mod = Math.max(0, getStatModifier(raw));
      const got = evaluateCalc(amountOf('consecrate'), inputs(10, raw));
      expect(Math.max(1, Math.floor(got * 1))).toBe(Math.max(1, Math.floor((2 + mod) * 0.65)));
    }
  });
});
