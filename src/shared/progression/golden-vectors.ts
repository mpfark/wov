/** Test/SQL parity fixtures, not runtime class configuration. Expected values are literals. */
import type { CapturedClassGrowth, ResourceProjection, StatDeltas, StatValues } from './contract';
import type { ResourcePolicyInput } from './resource-reference';

export const ORDER_GROWTH_FIXTURE = {
  warrior: { str: 1, dex: 1 }, wizard: { int: 1, wis: 1 }, ranger: { dex: 1, wis: 1 },
  assassin: { dex: 1, cha: 1 }, healer: { wis: 1, con: 1 }, bard: { cha: 1, int: 1 },
  templar: { wis: 1, con: 1 }, classless: {},
} as const satisfies Readonly<Record<string, StatDeltas>>;
export function classFixture(key: keyof typeof ORDER_GROWTH_FIXTURE): CapturedClassGrowth {
  return { classKey: key, isClassless: key === 'classless', configRevision: 'configured-reference-2026-10-04', levelBonuses: { ...ORDER_GROWTH_FIXTURE[key] } };
}
export const XP_GOLDEN_VECTORS = [
  { name: 'below threshold', level: 1, xp: 0, award: 49, after: [1, 49], points: 0, paid: 0, applied: 49, discarded: 0, growthLevels: [], milestones: [] },
  { name: 'exact first threshold', level: 1, xp: 0, award: 50, after: [2, 0], points: 1, paid: 50, applied: 50, discarded: 0, growthLevels: [], milestones: [] },
  { name: 'two exact thresholds', level: 1, xp: 0, award: 250, after: [3, 0], points: 2, paid: 250, applied: 250, discarded: 0, growthLevels: [3], milestones: [] },
  { name: 'two with remainder', level: 1, xp: 0, award: 260, after: [3, 10], points: 2, paid: 250, applied: 260, discarded: 0, growthLevels: [3], milestones: [] },
  { name: 'existing remainder', level: 2, xp: 190, award: 25, after: [3, 15], points: 1, paid: 200, applied: 25, discarded: 0, growthLevels: [3], milestones: [] },
  { name: 'five crossed levels', level: 2, xp: 0, award: 4500, after: [7, 0], points: 5, paid: 4500, applied: 4500, discarded: 0, growthLevels: [3, 6], milestones: [] },
  { name: 'cap exact', level: 41, xp: 0, award: 84050, after: [42, 0], points: 1, paid: 84050, applied: 84050, discarded: 0, growthLevels: [42], milestones: [] },
  { name: 'cap overflow', level: 41, xp: 0, award: 84060, after: [42, 0], points: 1, paid: 84050, applied: 84050, discarded: 10, growthLevels: [42], milestones: [] },
  { name: 'cap with existing remainder', level: 41, xp: 84040, award: 25, after: [42, 0], points: 1, paid: 84050, applied: 10, discarded: 15, growthLevels: [42], milestones: [] },
  { name: 'already at cap', level: 42, xp: 0, award: 25, after: [42, 0], points: 0, paid: 0, applied: 0, discarded: 25, growthLevels: [], milestones: [] },
  { name: 'zero award', level: 2, xp: 190, award: 0, after: [2, 190], points: 0, paid: 0, applied: 0, discarded: 0, growthLevels: [], milestones: [] },
  { name: 'milestone10', level: 9, xp: 0, award: 4050, after: [10, 0], points: 1, paid: 4050, applied: 4050, discarded: 0, growthLevels: [], milestones: [10] },
  { name: 'milestone20', level: 19, xp: 0, award: 18050, after: [20, 0], points: 1, paid: 18050, applied: 18050, discarded: 0, growthLevels: [], milestones: [20] },
  { name: 'milestone30', level: 29, xp: 0, award: 42050, after: [30, 0], points: 1, paid: 42050, applied: 42050, discarded: 0, growthLevels: [30], milestones: [30] },
  { name: 'milestone40', level: 39, xp: 0, award: 76050, after: [40, 0], points: 1, paid: 76050, applied: 76050, discarded: 0, growthLevels: [], milestones: [40] },
  { name: 'whole ordinary lifetime', level: 1, xp: 0, award: 1191050, after: [42, 0], points: 41, paid: 1191050, applied: 1191050, discarded: 0, growthLevels: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42], milestones: [10, 20, 30, 40] },
  { name: 'storage-safe maximum award', level: 1, xp: 0, award: 2147483647, after: [42, 0], points: 41, paid: 1191050, applied: 1191050, discarded: 2146292597, growthLevels: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42], milestones: [10, 20, 30, 40] },
] as const;
export const REFUSAL_GOLDEN_VECTORS = [
  { name: 'negative award', level: 1, xp: 0, award: -1, kind: 'refused', reason: 'invalid_award' },
  { name: 'fractional award', level: 1, xp: 0, award: 0.5, kind: 'refused', reason: 'invalid_award' },
  { name: 'null award', level: 1, xp: 0, award: null, kind: 'refused', reason: 'invalid_award' },
  { name: 'string award', level: 1, xp: 0, award: '50', kind: 'refused', reason: 'invalid_award' },
  { name: 'unsafe award', level: 1, xp: 0, award: Number.MAX_SAFE_INTEGER + 1, kind: 'refused', reason: 'invalid_award' },
  { name: 'beyond storage boundary', level: 1, xp: 0, award: 2147483648, kind: 'refused', reason: 'invalid_award' },
  { name: 'sum overflow', level: 2, xp: 1, award: 2147483647, kind: 'refused', reason: 'arithmetic_overflow' },
  { name: 'backlog', level: 2, xp: 200, award: 1, kind: 'reconciliation_required', reason: 'xp_backlog' },
  { name: 'cap anomaly', level: 42, xp: 1, award: 1, kind: 'reconciliation_required', reason: 'cap_xp_nonzero' },
  { name: 'negative historical xp', level: 2, xp: -1, award: 1, kind: 'reconciliation_required', reason: 'invalid_xp' },
  { name: 'null historical xp', level: 2, xp: null, award: 1, kind: 'reconciliation_required', reason: 'invalid_xp' },
  { name: 'level above cap', level: 43, xp: 0, award: 1, kind: 'reconciliation_required', reason: 'invalid_level' },
  { name: 'fractional level', level: 1.5, xp: 0, award: 1, kind: 'reconciliation_required', reason: 'invalid_level' },
] as const;

export const RESOURCE_POLICY_VECTORS: readonly { name: string; input: ResourcePolicyInput; expected: ResourceProjection }[] = [
  { name: 'living level refill HP only', input: { levelGained: true, alive: true, current: { hp: 5, cp: 7, mp: 8 }, final: { maxHp: 29, maxCp: 33, maxMp: 102, effectiveAc: 12 } }, expected: { hp: 29, cp: 7, mp: 8, maxHp: 29, maxCp: 33, maxMp: 102, effectiveAc: 12 } },
  { name: 'dead remains dead even with stale positive HP', input: { levelGained: true, alive: false, current: { hp: 5, cp: 7, mp: 8 }, final: { maxHp: 29, maxCp: 33, maxMp: 102, effectiveAc: 12 } }, expected: { hp: 0, cp: 7, mp: 8, maxHp: 29, maxCp: 33, maxMp: 102, effectiveAc: 12 } },
  { name: 'CP and MP clamp', input: { levelGained: true, alive: true, current: { hp: 5, cp: 90, mp: 120 }, final: { maxHp: 29, maxCp: 33, maxMp: 102, effectiveAc: 12 } }, expected: { hp: 29, cp: 33, mp: 102, maxHp: 29, maxCp: 33, maxMp: 102, effectiveAc: 12 } },
  { name: 'XP without level never refills', input: { levelGained: false, alive: true, current: { hp: 5, cp: 7, mp: 8 }, final: { maxHp: 24, maxCp: 30, maxMp: 100, effectiveAc: 12 } }, expected: { hp: 5, cp: 7, mp: 8, maxHp: 24, maxCp: 30, maxMp: 100, effectiveAc: 12 } },
  { name: 'max shrink clamp without level', input: { levelGained: false, alive: true, current: { hp: 100, cp: 90, mp: 120 }, final: { maxHp: 24, maxCp: 30, maxMp: 100, effectiveAc: 12 } }, expected: { hp: 24, cp: 30, mp: 100, maxHp: 24, maxCp: 30, maxMp: 100, effectiveAc: 12 } },
];
const stats = (con: number, int: number, wis: number, dex: number): StatValues => ({ str: 10, cha: 10, con, int, wis, dex });
export const RESOURCE_FORMULA_VECTORS = [
  { name: 'below mental/physical modifier boundary', level: 1, stats: stats(11, 11, 11, 11), gear: {}, shield: false, expected: [24, 30, 100, 12] },
  { name: 'INT boundary', level: 1, stats: stats(11, 12, 11, 11), gear: {}, shield: false, expected: [24, 33, 100, 12] },
  { name: 'WIS boundary', level: 1, stats: stats(11, 11, 12, 11), gear: {}, shield: false, expected: [24, 33, 100, 12] },
  { name: 'CON boundary', level: 1, stats: stats(12, 11, 11, 11), gear: {}, shield: false, expected: [26, 30, 100, 12] },
  { name: 'DEX boundary', level: 1, stats: stats(11, 11, 11, 12), gear: {}, shield: false, expected: [24, 30, 110, 13] },
  { name: 'mental negative excluded, CON negative retained', level: 1, stats: stats(8, 8, 8, 8), gear: {}, shield: false, expected: [22, 30, 100, 11] },
  { name: 'preaggregated valid gear plus shield once', level: 2, stats: stats(10, 10, 10, 10), gear: { hp: 5, con: 2, int: 2, wis: 2, dex: 2, ac: 3 }, shield: true, expected: [36, 39, 112, 17] },
] as const;
