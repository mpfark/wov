/**
 * ability-calc-parity.test.ts — Old-vs-new parity harness for the structured
 * ability calculation system.
 *
 * Every calc seeded in `ability-seed.ts` is evaluated across the full plausible
 * stat/level range and compared against the ORIGINAL hardcoded formulas.
 *
 * Checkpoint 7 deleted `shared/formulas/abilities.ts` from the runtime, so the
 * original curves are frozen *here* as a reference implementation. This file is
 * now the pin: it locks the seeded configuration to the balance the game
 * shipped with. A failure means the seed drifted — intentional balance changes
 * must update both the seed and the reference below, together and on purpose.
 */
import { describe, it, expect } from 'vitest';

import { evaluateCalc, type AbilityCalc, type CalcInputs, describeCalc, validateCalc } from '@/shared/formulas/ability-calc';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getStatModifier } from '@/shared/formulas/stats';
import { getEffectiveCombatMod } from '@/shared/formulas/effective';
import { diminishing, diminishingFloat } from '@/shared/formulas/stats';

// ── Frozen reference curves (the pre-config hardcoded formulas) ──────────
// Do not "fix" these to match a new seed; they are the historical baseline.
const getBattleCryDR = (strMod: number, hasShield: boolean) => {
  const base = 0.10 + diminishingFloat(Math.max(0, strMod), 0.02, 0.12);
  return { dr: base + (hasShield ? 0.05 : 0), critReduction: base };
};
const getRootReduction = (m: number) => 0.25 + diminishingFloat(Math.max(0, m), 0.02, 0.15);
const getDisengageMult = (m: number) => 1.30 + diminishingFloat(Math.max(0, m), 0.05, 0.40);
const getCloakDodge = (m: number) => 0.40 + diminishingFloat(Math.max(0, m), 0.03, 0.20);
const getEnvenomProc = (m: number) => 0.25 + diminishingFloat(Math.max(0, m), 0.04, 0.20);
const getEnvenomMaxStacks = (m: number) => 3 + diminishing(Math.max(0, m), 4);
const getArcaneSurgeMult = (m: number) => 1.10 + diminishingFloat(Math.max(0, m), 0.02, 0.12);
const getConflagratePerStack = (m: number) => 0.30 + diminishingFloat(Math.max(0, m), 0.05, 0.40);
const getIgniteOrbChance = (m: number) => 0.25 + diminishingFloat(Math.max(0, m), 0.04, 0.25);
const getIgnitePulseDamage = (m: number) => Math.max(1, Math.floor(2 + m));
const getIgniteBurnDamage = (m: number) => Math.max(1, Math.floor(getEffectiveCombatMod(Math.max(0, m), 'dot') * 0.7 * 0.67));
const getIgniteDuration = (m: number) => Math.min(45000, 30000 + Math.max(0, m) * 1000);
const getDivineChallengeFlat = (m: number) => Math.round(6 + diminishingFloat(Math.max(0, m), 1.8, 18));

const STATS = [1, 4, 8, 10, 12, 14, 16, 18, 20, 24, 30, 40];
const LEVELS = [1, 5, 10, 15, 20, 30, 42];

function byKey(key: string): (typeof ABILITY_SEED)[number] {
  const found = ABILITY_SEED.find(a => a.ability_key === key);
  if (!found) throw new Error(`seed missing ability ${key}`);
  return found;
}

function inputs(level: number, raw: number): CalcInputs {
  const m = getStatModifier(raw);
  return { level, mods: { str: m, dex: m, con: m, int: m, wis: m, cha: m } };
}

/** Sweep every stat/level combination and assert evaluator === legacy. */
function sweep(calc: AbilityCalc | null, legacy: (level: number, mod: number) => number, precision = 10) {
  expect(calc).not.toBeNull();
  for (const level of LEVELS) {
    for (const raw of STATS) {
      const i = inputs(level, raw);
      const got = evaluateCalc(calc!, i);
      const want = legacy(level, getStatModifier(raw));
      expect(
        Math.abs(got - want) < 10 ** -precision,
        `${JSON.stringify({ level, raw, got, want })}`,
      ).toBe(true);
    }
  }
}

describe('evaluator structural guarantees', () => {
  it('every seeded calc validates and renders a preview string', () => {
    for (const ability of ABILITY_SEED) {
      for (const calc of [ability.amount_calc, ability.duration_calc]) {
        if (!calc) continue;
        expect(validateCalc(calc), `${ability.ability_key}`).toEqual([]);
        expect(describeCalc(calc).length).toBeGreaterThan(0);
      }
    }
  });

  it('applies base → terms → postMult → rounding → floor → cap in order', () => {
    const calc: AbilityCalc = {
      base: 10, terms: [{ source: 'stat', stat: 'str', mult: 2 }],
      postMult: 0.5, rounding: 'floor', floor: 6, cap: 12, unit: 'flat',
    };
    expect(evaluateCalc(calc, inputs(1, 10))).toBe(6);   // (10 + 0) * 0.5 = 5 → floor clamp 6
    expect(evaluateCalc(calc, inputs(1, 18))).toBe(9);   // (10 + 8) * 0.5 = 9
    expect(evaluateCalc(calc, inputs(1, 40))).toBe(12);  // (10 + 30) * 0.5 = 20 → cap 12
  });

  it('threshold ladders only fire at or above their step', () => {
    const calc: AbilityCalc = {
      base: 2, terms: [{ source: 'stat_threshold', stat: 'dex', steps: [{ at: 3, add: 1 }, { at: 6, add: 1 }] }],
      cap: 4, unit: 'count',
    };
    expect(evaluateCalc(calc, inputs(1, 10))).toBe(2);  // mod 0
    expect(evaluateCalc(calc, inputs(1, 16))).toBe(3);  // mod 3
    expect(evaluateCalc(calc, inputs(1, 24))).toBe(4);  // mod 7 → both steps
    expect(evaluateCalc(calc, inputs(1, 40))).toBe(4);  // capped
  });
});

describe('duration parity (ms)', () => {
  it('Rend — 20s + DEX, cap 30s', () => {
    sweep(byKey('rend').duration_calc, (_l, m) => Math.min(30000, 20000 + Math.max(0, m) * 1000));
  });
  it('Sunder Armor — 12s + DEX, cap 20s', () => {
    sweep(byKey('sunder_armor').duration_calc, (_l, m) => Math.min(20, 12 + Math.max(0, m)) * 1000);
  });
  it("Nature's Snare — 8s + WIS, cap 15s", () => {
    sweep(byKey('natures_snare').duration_calc, (_l, m) => Math.min(15000, 8000 + Math.max(0, m) * 1000));
  });
  it('Dissonance — 8s + INT, cap 15s', () => {
    sweep(byKey('dissonance').duration_calc, (_l, m) => Math.min(15000, 8000 + Math.max(0, m) * 1000));
  });
  it('Inspire — 60s floor, +8s per INT, cap 180s', () => {
    sweep(byKey('inspire').duration_calc, (_l, m) => Math.min(180_000, Math.max(60_000, 60_000 + Math.max(0, m) * 8_000)));
  });
  it('Shadowstep — 15s + DEX (unclamped), cap 25s', () => {
    sweep(byKey('shadowstep').duration_calc, (_l, m) => Math.min(15000 + m * 1000, 25000));
  });
  it('Cloak of Shadows — 10s + DEX×500ms, cap 15s', () => {
    sweep(byKey('cloak_of_shadows').duration_calc, (_l, m) => Math.min(15000, 10000 + m * 500));
  });
  it('Disengage — 5s + DEX×500ms, cap 8s', () => {
    sweep(byKey('disengage').duration_calc, (_l, m) => Math.min(8000, 5000 + m * 500));
  });
  it('Force Shield (legacy timed) — 8s + INT, cap 15s', () => {
    sweep(byKey('force_shield').duration_calc, (_l, m) => Math.min(15000, 8000 + m * 1000));
  });
  it('Purifying Light — 15s + CON, cap 30s', () => {
    sweep(byKey('purifying_light').duration_calc, (_l, m) => Math.min(30000, 15000 + Math.max(0, m) * 1000));
  });
  it('Crescendo — 15s + INT, cap 30s', () => {
    sweep(byKey('crescendo').duration_calc, (_l, m) => Math.min(30000, 15000 + Math.max(0, m) * 1000));
  });
  it('Divine Aegis — 30s + CON×2s, cap 60s', () => {
    sweep(byKey('divine_aegis').duration_calc, (_l, m) => Math.min(60_000, 30_000 + Math.max(0, m) * 2_000));
  });
  it('Divine Challenge — 30s + CON, cap 45s', () => {
    sweep(byKey('divine_challenge').duration_calc, (_l, m) => Math.min(45_000, 30_000 + Math.max(0, m) * 1_000));
  });
  it('Consecrate — CON tick ladder × 2s interval', () => {
    sweep(byKey('consecrate').duration_calc, (_l, m) => {
      const con = Math.max(0, m);
      const ticks = Math.min(5, 3 + (con >= 3 ? 1 : 0) + (con >= 6 ? 1 : 0));
      return ticks * 2_000;
    });
  });
  it('fixed-duration legacy previews stay pinned at 30s', () => {
    sweep(byKey('eagle_eye').duration_calc, () => 30_000);
    sweep(byKey('holy_shield').duration_calc, () => 30_000);
  });
});

describe('magnitude parity', () => {
  it('Second Wind — CON×3 + level, floor 3', () => {
    sweep(byKey('second_wind').amount_calc, (l, m) => Math.max(3, m * 3 + l));
  });
  it('Heal — WIS×3 + level, floor 3', () => {
    sweep(byKey('heal').amount_calc, (l, m) => Math.max(3, m * 3 + l));
  });
  it('Transfer Health — WIS×2 + floor(level/2), floor 3', () => {
    sweep(byKey('transfer_health').amount_calc, (l, m) => Math.max(3, m * 2 + Math.floor(l / 2)));
  });
  it('Divine Aegis pool — WIS×2 + floor(level×0.7)', () => {
    sweep(byKey('divine_aegis').amount_calc, (l, m) => m * 2 + Math.floor(l * 0.7));
  });
  it('Force Shield pool — WIS + floor(level×0.5), floor 1', () => {
    sweep(byKey('force_shield').amount_calc, (l, m) => Math.max(1, m + Math.floor(l * 0.5)));
  });
  it('Purifying Light / Crescendo — mod + 2, floor 1', () => {
    sweep(byKey('purifying_light').amount_calc, (_l, m) => Math.max(1, m + 2));
    sweep(byKey('crescendo').amount_calc, (_l, m) => Math.max(1, m + 2));
  });
  it('Inspire HP regen — max(2, CHA + 2)', () => {
    sweep(byKey('inspire').amount_calc, (_l, m) => Math.max(2, Math.max(0, m) + 2));
  });
  it('Inspire CP regen — max(1, ceil(CHA/2) + 1)', () => {
    const cpCalc = byKey('inspire').mechanic_calcs!.cp_per_tick as AbilityCalc;
    sweep(cpCalc, (_l, m) => Math.max(1, Math.ceil(Math.max(0, m) / 2) + 1));
  });
  it('Eagle Eye — floor((DEX + WIS)/2), 1..5', () => {
    sweep(byKey('eagle_eye').amount_calc, (_l, m) => Math.max(1, Math.min(5, Math.floor((Math.max(0, m) + Math.max(0, m)) / 2))));
  });
  it('Rend per-tick — soft-capped STR curve', () => {
    sweep(byKey('rend').amount_calc, (_l, m) => Math.max(1, Math.floor((getEffectiveCombatMod(Math.max(0, m), 'dot') * 1.5 + 2) * 0.67)));
  });
  it('Sunder Armor AC reduction — 2 + soft(STR, utility)', () => {
    sweep(byKey('sunder_armor').amount_calc, (_l, m) => Math.round(2 + getEffectiveCombatMod(Math.max(0, m), 'utility')));
  });
  it('Shadowstep ambush multiplier — 2 + CHA×0.05, cap 2.5', () => {
    sweep(byKey('shadowstep').amount_calc, (_l, m) => Math.min(2.5, 2 + Math.max(0, m) * 0.05));
  });
  it('Battle Cry DR — matches getBattleCryDR (shieldless base)', () => {
    sweep(byKey('battle_cry').amount_calc, (_l, m) => getBattleCryDR(m, false).critReduction);
  });
  it("Nature's Snare / Dissonance reduction — matches getRootReduction", () => {
    sweep(byKey('natures_snare').amount_calc, (_l, m) => getRootReduction(m));
    sweep(byKey('dissonance').amount_calc, (_l, m) => getRootReduction(m));
  });
  it('Disengage next-hit multiplier — matches getDisengageMult', () => {
    sweep(byKey('disengage').amount_calc, (_l, m) => getDisengageMult(m));
  });
  it('Cloak of Shadows dodge — matches getCloakDodge', () => {
    sweep(byKey('cloak_of_shadows').amount_calc, (_l, m) => getCloakDodge(m));
  });
  it('Envenom proc + max stacks — match legacy helpers', () => {
    sweep(byKey('envenom').amount_calc, (_l, m) => getEnvenomProc(m));
    const stacks = byKey('envenom').mechanic_calcs!.max_stacks as AbilityCalc;
    sweep(stacks, (_l, m) => getEnvenomMaxStacks(m));
  });
  it('Arcane Surge multiplier — matches getArcaneSurgeMult', () => {
    sweep(byKey('arcane_surge').amount_calc, (_l, m) => getArcaneSurgeMult(m));
  });
  it('Ignite supported values match the live formulas', () => {
    const ignite = byKey('ignite');
    sweep(byKey('ignite').amount_calc, (_l, m) => getIgniteOrbChance(m));
    sweep(ignite.duration_calc, (_l, m) => getIgniteDuration(m));
    sweep(ignite.mechanic_calcs!.pulse_damage, (_l, m) => getIgnitePulseDamage(m));
    sweep(ignite.mechanic_calcs!.burn_damage, (_l, m) => getIgniteBurnDamage(m));
    sweep(ignite.mechanic_calcs!.max_stacks, () => 5);
    expect(ignite.interval_ms).toBe(2000);
  });
  it('Conflagrate per-stack ratio — matches getConflagratePerStack', () => {
    sweep(byKey('conflagrate').mechanic_calcs!.per_stack_multiplier, (_l, m) => getConflagratePerStack(m));
  });
  it('Barrage arrow count', () => {
    const count = byKey('barrage').mechanic_calcs!.arrow_count as AbilityCalc;
    sweep(count, (_l, m) => {
      const mod = Math.max(0, m);
      return Math.min(4, 2 + (mod >= 3 ? 1 : 0) + (mod >= 4 ? 1 : 0));
    });
  });
  it('Divine Challenge flat mitigation — matches getDivineChallengeFlat', () => {
    sweep(byKey('divine_challenge').amount_calc, (_l, m) => getDivineChallengeFlat(m));
  });
  it('Transfer Health safety floor — max(1, CON)', () => {
    const reserve = byKey('transfer_health').mechanic_calcs!.reserve_hp as AbilityCalc;
    sweep(reserve, (_l, m) => Math.max(1, m));
  });
});

describe('seed shape', () => {
  it('covers 7 classes × 5 role slots with unique ability keys', () => {
    expect(ABILITY_SEED.length).toBe(35);
    expect(new Set(ABILITY_SEED.map(a => a.ability_key)).size).toBe(35);
    const byClass = new Map<string, Set<number>>();
    for (const a of ABILITY_SEED) {
      if (!byClass.has(a.class_key)) byClass.set(a.class_key, new Set());
      byClass.get(a.class_key)!.add(a.slot);
    }
    expect(byClass.size).toBe(7);
    for (const [cls, slots] of byClass) {
      expect(Array.from(slots).sort(), cls).toEqual([0, 1, 2, 3, 4]);
    }
  });

  it('stances carry a CP reservation percentage and non-stances do not', () => {
    for (const a of ABILITY_SEED) {
      if (a.activation_mode === 'stance') expect(a.cp_reserve_pct, a.ability_key).toBeGreaterThan(0);
      else expect(a.cp_reserve_pct, a.ability_key).toBeNull();
    }
  });
});
