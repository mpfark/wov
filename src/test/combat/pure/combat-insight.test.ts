/**
 * combat-insight.test.ts — INT's secondary to-hit contribution.
 *
 * Combat Insight is an addition to the Batch 2 accuracy formula, not a change
 * to it: proficiency, the bounded primary-stat accuracy bonus, weapon-affinity
 * gating, crit rules and damage all stay exactly as Batch 2 left them.
 *
 *   totalAttack = d20 + proficiency + accuracyBonus + insight + affinityHit
 */

import { describe, expect, it } from 'vitest';
import {
  getIntHitBonus,
  getCombatInsightBonus,
  getAccuracyBonus,
  getAccuracyProficiency,
  getWisAntiCrit,
  type AccuracyStat,
} from '@/shared/formulas/combat';
import { getStatModifier, diminishing } from '@/shared/formulas/stats';
import { seededAttackRoll } from '@/shared/combat/pure/rolls';
import type { RngStream, TickRandom } from '@/shared/combat/pure/rng';
import { predictConservativeDamage } from '@/features/combat/utils/combat-predictor';
import { participant, CONFIG } from './fixtures';

/** A fully deterministic RNG that records every stream draw it is asked for. */
function fixedRng(d20: number, dieRoll: number, sample = 0.99) {
  const draws: RngStream[] = [];
  const rng: TickRandom = {
    sample(stream) {
      draws.push(stream);
      return sample;
    },
    roll(stream, sides) {
      draws.push(stream);
      return sides === 20 ? d20 : Math.min(dieRoll, sides);
    },
    pick(stream, items) {
      draws.push(stream);
      return items[0] ?? null;
    },
    weighted(stream, items) {
      draws.push(stream);
      return items[0] ?? null;
    },
  } as unknown as TickRandom;
  return { rng, draws };
}

function attack(opts: {
  accuracyStat: AccuracyStat;
  weaponBased: boolean;
  int: number;
  d20?: number;
  creatureAC: number;
  classKey?: string;
  weaponTag?: string | null;
}) {
  const p = participant({
    level: 12,
    classKey: opts.classKey ?? 'warrior',
    attrs: { str: 16, dex: 14, con: 15, int: opts.int, wis: 14, cha: 14 },
    weapon: {
      tag: opts.weaponTag === undefined ? 'sword' : opts.weaponTag,
      hands: 1,
      itemLevel: 12,
      rarity: 'uncommon',
      equippedInventoryIds: [],
    },
  });
  const { rng, draws } = fixedRng(opts.d20 ?? 10, 3);
  const res = seededAttackRoll({
    rng,
    attacker: p,
    creatureId: 'crt-1',
    creatureAC: opts.creatureAC,
    accuracyStat: opts.accuracyStat,
    weaponBased: opts.weaponBased,
    progression: CONFIG.weaponProgression,
    key: ['t', 1],
  });
  return { res, draws };
}

describe('Combat Insight — restored getIntHitBonus', () => {
  it('matches the historical curve and cap exactly', () => {
    // Historical implementation: diminishing(getStatModifier(int), 5)
    for (let int = 0; int <= 60; int++) {
      expect(getIntHitBonus(int)).toBe(diminishing(getStatModifier(int), 5));
    }
    // Spot checks of the shipped curve, including the +5 cap.
    expect(getIntHitBonus(10)).toBe(0);
    expect(getIntHitBonus(12)).toBe(1);
    expect(getIntHitBonus(18)).toBe(2);
    expect(getIntHitBonus(28)).toBe(3);
    expect(getIntHitBonus(42)).toBe(4);
    expect(getIntHitBonus(60)).toBe(5);
    expect(getIntHitBonus(200)).toBe(5);
  });

  it('suppresses itself only for INT-primary accuracy', () => {
    for (const stat of ['str', 'dex', 'con', 'wis', 'cha'] as AccuracyStat[]) {
      expect(getCombatInsightBonus(stat, 30)).toBe(getIntHitBonus(30));
    }
    expect(getCombatInsightBonus('int', 30)).toBe(0);
  });
});

describe('Combat Insight — resolver to-hit', () => {
  const cases: Array<[string, AccuracyStat, boolean]> = [
    ['DEX-primary weapon attack', 'dex', true],
    ['WIS-primary divine attack', 'wis', false],
    ['CHA-primary bard attack', 'cha', false],
  ];

  for (const [label, stat, weaponBased] of cases) {
    it(`${label} gains accuracy from INT`, () => {
      const low = attack({ accuracyStat: stat, weaponBased, int: 10, creatureAC: 20 });
      const high = attack({ accuracyStat: stat, weaponBased, int: 30, creatureAC: 20 });
      expect(high.res.totalAtk - low.res.totalAtk).toBe(getIntHitBonus(30));
      expect(high.res.totalAtk).toBeGreaterThan(low.res.totalAtk);
    });
  }

  it('does not count INT twice for INT-primary attacks', () => {
    const low = attack({ accuracyStat: 'int', weaponBased: false, int: 10, creatureAC: 20 });
    const high = attack({ accuracyStat: 'int', weaponBased: false, int: 30, creatureAC: 20 });
    // The only INT contribution is the primary accuracy bonus.
    const expected =
      getAccuracyBonus(getStatModifier(30)) - getAccuracyBonus(getStatModifier(10));
    expect(high.res.totalAtk - low.res.totalAtk).toBe(expected);
  });

  it('gives autoattacks DEX accuracy plus Combat Insight', () => {
    const { res } = attack({
      accuracyStat: 'dex',
      weaponBased: true,
      int: 18,
      d20: 7,
      creatureAC: 20,
      classKey: 'warrior',
      weaponTag: 'sword',
    });
    const expected =
      7
      + getAccuracyProficiency(12)
      + getAccuracyBonus(getStatModifier(14)) // DEX
      + getIntHitBonus(18)
      + 1; // warrior/sword affinity
    expect(res.totalAtk).toBe(expected);
  });

  it('keeps weapon affinity out of non-weapon attacks while Insight still applies', () => {
    const spell = attack({
      accuracyStat: 'wis',
      weaponBased: false,
      int: 18,
      d20: 7,
      creatureAC: 20,
      classKey: 'warrior',
      weaponTag: 'sword',
    });
    const expected =
      7
      + getAccuracyProficiency(12)
      + getAccuracyBonus(getStatModifier(14)) // WIS
      + getIntHitBonus(18); // no affinity term
    expect(spell.res.totalAtk).toBe(expected);
  });

  it('matches the client hit-chance preview exactly for autoattacks', () => {
    const level = 12;
    const dex = 14;
    const int = 22;
    const creatureAC = 24;
    const { res } = attack({
      accuracyStat: 'dex',
      weaponBased: true,
      int,
      d20: 11,
      creatureAC,
      classKey: 'warrior',
      weaponTag: 'sword',
    });

    // Client preview bonus (CharacterPanel / StatPlanner / predictor share these terms).
    const previewBonus =
      getAccuracyProficiency(level)
      + getAccuracyBonus(getStatModifier(dex))
      + getCombatInsightBonus('dex', int)
      + 1; // affinity
    expect(res.totalAtk - 11).toBe(previewBonus);

    // The damage predictor derives its threshold from the same bonus.
    const prediction = predictConservativeDamage({
      classKey: 'warrior',
      attackerStat: dex,
      level,
      int,
      str: 16,
      creatureAC,
      weaponTag: 'sword',
      weaponHands: 1,
      weaponItemLevel: 12,
      weaponItemRarity: 'uncommon',
    });
    const threshold = Math.max(creatureAC - previewBonus, 1);
    const hitChance = Math.min((21 - threshold) / 20, 1);
    expect(prediction.shouldPredict).toBe(hitChance >= 0.7);
  });

  it('leaves WIS critical-hit reduction unchanged', () => {
    expect(getWisAntiCrit(10)).toBe(0);
    expect(getWisAntiCrit(14)).toBeCloseTo(0.03, 10);
    expect(getWisAntiCrit(20)).toBeCloseTo(Math.sqrt(5) * 0.03, 10);
    expect(getWisAntiCrit(200)).toBeCloseTo(0.15, 10);
  });

  it('adds no extra hit or crit roll', () => {
    const { draws } = attack({
      accuracyStat: 'dex',
      weaponBased: true,
      int: 30,
      d20: 12,
      creatureAC: 15,
    });
    expect(draws.filter(s => s === 'attack_roll')).toHaveLength(1);
    expect(draws.filter(s => s === 'attack_damage')).toHaveLength(1);
    expect(draws).toHaveLength(2);
  });

  it('does not change crit thresholds or damage for a fixed roll', () => {
    const low = attack({ accuracyStat: 'dex', weaponBased: true, int: 10, d20: 20, creatureAC: 20 });
    const high = attack({ accuracyStat: 'dex', weaponBased: true, int: 30, d20: 20, creatureAC: 20 });
    expect(low.res.isCrit).toBe(true);
    expect(high.res.isCrit).toBe(true);
    expect(high.res.baseDamage).toBe(low.res.baseDamage);
  });
});
