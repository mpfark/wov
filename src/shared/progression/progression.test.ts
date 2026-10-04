import { describe, expect, it } from 'vitest';
import { calculateXpTransition } from './reference';
import { applyLevelResourcePolicy } from './resource-reference';
import { classFixture, ORDER_GROWTH_FIXTURE, XP_GOLDEN_VECTORS, REFUSAL_GOLDEN_VECTORS, RESOURCE_POLICY_VECTORS, RESOURCE_FORMULA_VECTORS } from './golden-vectors';
import { getEffectiveMaxHp, getEffectiveMaxCp, getEffectiveMaxMp } from '../formulas/resources';
import { getEffectiveAC } from '../formulas/combat';
import type { CapturedClassGrowth, XpAuthorityResult, XpCommitReceipt } from './contract';

describe('001A non-persisting progression oracle — not database integration proof', () => {
  it.each(XP_GOLDEN_VECTORS)('$name', vector => {
    const result = calculateXpTransition({ level: vector.level, xp: vector.xp, offeredXp: vector.award, capturedClass: classFixture('wizard'), claimedRespecMilestones: [] });
    expect(result.kind).toBe('calculated');
    if (result.kind !== 'calculated') throw new Error('Expected calculated reference');
    const t = result.transition;
    expect(t.before).toEqual({ level: vector.level, xp: vector.xp });
    expect(t.after).toEqual({ level: vector.after[0], xp: vector.after[1] });
    expect([t.discretionaryPointsGranted, t.thresholdsPaid, t.appliedXp, t.discardedXp]).toEqual([vector.points, vector.paid, vector.applied, vector.discarded]);
    expect(t.crossedLevels.filter(l => Object.keys(l.classGrowth).length).map(l => l.toLevel)).toEqual(vector.growthLevels);
    expect(t.respecMilestonesGranted).toEqual(vector.milestones);
    expect(t.permanentStatDeltas).toEqual(vector.growthLevels.length ? { int: vector.growthLevels.length, wis: vector.growthLevels.length } : {});
    expect(t.offeredXp).toBe(t.appliedXp + t.discardedXp);
    expect(vector.xp + t.appliedXp).toBe(t.thresholdsPaid + t.after.xp);
    expect(t.crossedLevels.map(l => l.toLevel)).toEqual(Array.from({ length: vector.points }, (_, i) => vector.level + i + 1));
    expect(t.crossedLevels.every(l => l.discretionaryPoints === 1)).toBe(true);
    expect(t.nextThreshold).toBe(t.after.level === 42 ? null : 50 * t.after.level ** 2);
  });
  it.each(REFUSAL_GOLDEN_VECTORS)('$name', vector => {
    expect(calculateXpTransition({ level: vector.level, xp: vector.xp, offeredXp: vector.award, capturedClass: classFixture('wizard'), claimedRespecMilestones: [] }))
      .toEqual({ kind: vector.kind, reason: vector.reason });
  });
  it.each(Object.keys(ORDER_GROWTH_FIXTURE) as (keyof typeof ORDER_GROWTH_FIXTURE)[])('L2→3 uses supplied %s configuration', key => {
    const r = calculateXpTransition({ level: 2, xp: 0, offeredXp: 200, capturedClass: classFixture(key), claimedRespecMilestones: [] });
    if (r.kind !== 'calculated') throw new Error('Expected transition');
    expect(r.transition.after).toEqual({ level: 3, xp: 0 });
    expect(r.transition.permanentStatDeltas).toEqual(ORDER_GROWTH_FIXTURE[key]);
    expect(r.transition.discretionaryPointsGranted).toBe(1);
  });
  it('uses actual configured deltas rather than hardcoded Order identity', () => {
    const configured = { ...classFixture('assassin'), configRevision: 'changed-fixture', levelBonuses: { int: 3, con: 2 } };
    const r = calculateXpTransition({ level: 2, xp: 0, offeredXp: 4500, capturedClass: configured, claimedRespecMilestones: [] });
    if (r.kind !== 'calculated') throw new Error('Expected transition');
    expect(r.transition.permanentStatDeltas).toEqual({ int: 6, con: 4 });
    expect(r.transition.capturedClass.configRevision).toBe('changed-fixture');
  });
  it('sequential events preserve mixed growth without classless catch-up', () => {
    const run = (level: number, xp: number, award: number, key: keyof typeof ORDER_GROWTH_FIXTURE) => {
      const r = calculateXpTransition({ level, xp, offeredXp: award, capturedClass: classFixture(key), claimedRespecMilestones: [] });
      if (r.kind !== 'calculated') throw new Error('Expected transition');
      return r.transition;
    };
    const warrior = run(2, 0, 200, 'warrior');
    const reach4 = run(warrior.after.level, warrior.after.xp, 450, 'warrior');
    const wizard = run(reach4.after.level, reach4.after.xp, 2050, 'wizard');
    expect(warrior.permanentStatDeltas).toEqual({ str: 1, dex: 1 });
    expect(reach4.permanentStatDeltas).toEqual({});
    expect(wizard.after).toEqual({ level: 6, xp: 0 });
    expect(wizard.permanentStatDeltas).toEqual({ int: 1, wis: 1 });
    const wayfarer = run(2, 0, 650, 'classless');
    expect(wayfarer.after).toEqual({ level: 4, xp: 0 });
    expect(wayfarer.permanentStatDeltas).toEqual({});
    expect(wayfarer.discretionaryPointsGranted).toBe(2);
    const joined = run(4, 0, 2050, 'wizard');
    expect(joined.permanentStatDeltas).toEqual({ int: 1, wis: 1 });
  });
  it('suppresses previously claimed milestone eligibility without refunding admin tokens', () => {
    const r = calculateXpTransition({ level: 1, xp: 0, offeredXp: 1191050, capturedClass: classFixture('classless'), claimedRespecMilestones: [10, 30] });
    if (r.kind !== 'calculated') throw new Error('Expected transition');
    expect(r.transition.respecMilestonesGranted).toEqual([20, 40]);
    expect(r.transition.crossedLevels.find(l => l.toLevel === 10)?.respecMilestone).toBeNull();
    expect(r.transition.discretionaryPointsGranted).toBe(41);
    expect(r.transition).not.toHaveProperty('materialRewards');
  });
  it('is deterministic and does not mutate inputs; calculation is not replay protection', () => {
    const input = { level: 2, xp: 0, offeredXp: 4500, capturedClass: classFixture('wizard'), claimedRespecMilestones: [] };
    const before = JSON.stringify(input);
    const first = calculateXpTransition(input);
    expect(calculateXpTransition(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    if (first.kind !== 'calculated') throw new Error('Expected transition');
    (input.capturedClass.levelBonuses as { int?: number }).int = 99;
    expect(first.transition.permanentStatDeltas).toEqual({ int: 2, wis: 2 });
  });
  it.each([NaN, Infinity, -Infinity, undefined])('rejects malformed award %s', offeredXp => {
    expect(calculateXpTransition({ level: 1, xp: 0, offeredXp, capturedClass: classFixture('wizard'), claimedRespecMilestones: [] }))
      .toEqual({ kind: 'refused', reason: 'invalid_award' });
  });
  it.each([{ luck: 1 }, { str: -1 }, { int: 0.5 }, { dex: 2147483647 }])('rejects malformed configured growth %j', bonuses => {
    const capturedClass = { ...classFixture('wizard'), levelBonuses: bonuses } as CapturedClassGrowth;
    expect(calculateXpTransition({ level: 2, xp: 0, offeredXp: 200, capturedClass, claimedRespecMilestones: [] }))
      .toEqual({ kind: 'refused', reason: 'invalid_class_config' });
  });
  it('refuses inconsistent classless config and milestone history', () => {
    expect(calculateXpTransition({ level: 2, xp: 0, offeredXp: 200, capturedClass: { ...classFixture('classless'), levelBonuses: { str: 1 } }, claimedRespecMilestones: [] }))
      .toEqual({ kind: 'refused', reason: 'invalid_class_config' });
    expect(calculateXpTransition({ level: 9, xp: 0, offeredXp: 4050, capturedClass: classFixture('wizard'), claimedRespecMilestones: [10, 10] }))
      .toEqual({ kind: 'refused', reason: 'invalid_milestone_history' });
  });
});

describe('resource formulas and approved ordinary level policy — no persistent sync', () => {
  it.each(RESOURCE_FORMULA_VECTORS)('$name', v => {
    expect([
      getEffectiveMaxHp('warrior', v.stats.con, v.level, v.gear),
      getEffectiveMaxCp(v.level, v.stats.int, v.stats.wis, v.gear),
      getEffectiveMaxMp(v.level, v.stats.dex, v.gear),
      getEffectiveAC('warrior', v.stats.dex, v.gear, v.shield),
    ]).toEqual(v.expected);
  });
  it.each(RESOURCE_POLICY_VECTORS)('$name', v => {
    const before = JSON.stringify(v.input);
    expect(applyLevelResourcePolicy(v.input)).toEqual(v.expected);
    expect(JSON.stringify(v.input)).toBe(before);
  });
  it('applies final multi-level class growth before one HP refill', () => {
    const r = calculateXpTransition({ level: 2, xp: 0, offeredXp: 4500, capturedClass: classFixture('healer'), claimedRespecMilestones: [] });
    if (r.kind !== 'calculated') throw new Error('Expected transition');
    expect(r.transition.permanentStatDeltas).toEqual({ wis: 2, con: 2 });
    const level = r.transition.after.level;
    const final = { maxHp: getEffectiveMaxHp('healer', 12, level, {}), maxCp: getEffectiveMaxCp(level, 10, 12, {}), maxMp: getEffectiveMaxMp(level, 10, {}), effectiveAc: getEffectiveAC('healer', 10, {}, false) };
    expect(applyLevelResourcePolicy({ levelGained: true, alive: true, current: { hp: 2, cp: 7, mp: 8 }, final }))
      .toEqual({ maxHp: 50, hp: 50, maxCp: 51, cp: 7, maxMp: 112, mp: 8, effectiveAc: 9 });
  });
});

describe('closed future receipt shapes — not simulated DB exactly-once', () => {
  it('represents replay as the original historical receipt, distinct from a fresh projection', () => {
    const calculated = calculateXpTransition({ level: 1, xp: 0, offeredXp: 50, capturedClass: classFixture('classless'), claimedRespecMilestones: [] });
    if (calculated.kind !== 'calculated') throw new Error('Expected transition');
    const receipt: XpCommitReceipt = {
      identity: { source: 'craft_completion', characterId: 'fixture-character', completionId: 'stable-fixture-completion' },
      transition: calculated.transition, milestoneReceipts: [], versionBefore: 4,
      after: { characterId: 'fixture-character', progressionVersion: 5, level: 2, xp: 0, permanentStats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, unspentStatPoints: 1, respecPoints: 0, resources: RESOURCE_POLICY_VECTORS[0].expected },
    };
    const replay: XpAuthorityResult = { kind: 'replayed', original: receipt };
    expect(replay.original.after.progressionVersion).toBe(5);
    expect(replay.original.transition.before.level).toBe(1);
    expect(replay).not.toHaveProperty('after');
    // @ts-expect-error A refusal cannot contain a successful authoritative receipt.
    const invalid: XpAuthorityResult = { kind: 'refused', reason: 'unauthorized', receipt };
    expect(invalid.kind).toBe('refused');
  });
});
