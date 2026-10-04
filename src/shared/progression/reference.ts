/** Non-persisting 001A calculation oracle for later SQL parity tests.
 * No authentication, receipts, locks, inventory, resource writes or gameplay imports.
 * A calculated result is NOT a committed award. Do not wire into runtime writers.
 */
import { getXpForLevel } from '../formulas/xp';
import { PROGRESSION_CONTRACT_VERSION, PROGRESSION_RULES_VERSION, STAT_KEYS } from './contract';
import type { CapturedClassGrowth, LevelTransition, ReferenceResult, RespecMilestoneLevel, StatKey } from './contract';

export const MAX_REFERENCE_XP = 2_147_483_647; // Current integer storage-safe envelope, not a balance cap.
const milestones: readonly RespecMilestoneLevel[] = [10, 20, 30, 40];
export interface ReferenceInput {
  readonly level: unknown;
  readonly xp: unknown;
  readonly offeredXp: unknown;
  readonly capturedClass: CapturedClassGrowth;
  readonly claimedRespecMilestones: readonly RespecMilestoneLevel[];
}
const nonnegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function validConfig(config: CapturedClassGrowth): boolean {
  if (!config || typeof config.classKey !== 'string' || !config.classKey.trim()
    || typeof config.configRevision !== 'string' || !config.configRevision.trim()
    || typeof config.isClassless !== 'boolean' || config.isClassless !== (config.classKey === 'classless')
    || !config.levelBonuses || typeof config.levelBonuses !== 'object' || Array.isArray(config.levelBonuses)) return false;
  return Object.entries(config.levelBonuses).every(([key, value]) =>
    STAT_KEYS.includes(key as StatKey) && nonnegativeInt(value) && value <= Math.floor(MAX_REFERENCE_XP / 14)
    && (!config.isClassless || value === 0));
}

export function calculateXpTransition(input: ReferenceInput): ReferenceResult {
  const { level, xp, offeredXp } = input;
  if (!nonnegativeInt(offeredXp) || offeredXp > MAX_REFERENCE_XP) return { kind: 'refused', reason: 'invalid_award' };
  if (!nonnegativeInt(level) || level < 1 || level > 42) return { kind: 'reconciliation_required', reason: 'invalid_level' };
  if (!nonnegativeInt(xp) || xp > MAX_REFERENCE_XP) return { kind: 'reconciliation_required', reason: 'invalid_xp' };
  if (level === 42 && xp !== 0) return { kind: 'reconciliation_required', reason: 'cap_xp_nonzero' };
  if (level < 42 && xp >= getXpForLevel(level)) return { kind: 'reconciliation_required', reason: 'xp_backlog' };
  if (!validConfig(input.capturedClass)) return { kind: 'refused', reason: 'invalid_class_config' };
  if (!Array.isArray(input.claimedRespecMilestones)
    || input.claimedRespecMilestones.some(value => !milestones.includes(value))
    || new Set(input.claimedRespecMilestones).size !== input.claimedRespecMilestones.length) {
    return { kind: 'refused', reason: 'invalid_milestone_history' };
  }
  if (xp + offeredXp > MAX_REFERENCE_XP) return { kind: 'refused', reason: 'arithmetic_overflow' };

  const capturedClass = { ...input.capturedClass, levelBonuses: { ...input.capturedClass.levelBonuses } };
  let nextLevel = level;
  let remainder = xp + offeredXp;
  let thresholdsPaid = 0;
  const crossedLevels: LevelTransition[] = [];
  const permanentStatDeltas: Partial<{ [K in StatKey]: number }> = {};
  const respecMilestonesGranted: RespecMilestoneLevel[] = [];
  while (nextLevel < 42 && remainder >= getXpForLevel(nextLevel)) {
    const thresholdPaid = getXpForLevel(nextLevel);
    remainder -= thresholdPaid;
    thresholdsPaid += thresholdPaid;
    const fromLevel = nextLevel++;
    const classGrowth = nextLevel % 3 === 0 && !capturedClass.isClassless ? { ...capturedClass.levelBonuses } : {};
    for (const key of STAT_KEYS) {
      const delta = classGrowth[key] ?? 0;
      if (delta !== 0) permanentStatDeltas[key] = (permanentStatDeltas[key] ?? 0) + delta;
    }
    const respecMilestone = milestones.find(value => value === nextLevel && !input.claimedRespecMilestones.includes(value)) ?? null;
    if (respecMilestone !== null) respecMilestonesGranted.push(respecMilestone);
    crossedLevels.push({ fromLevel, toLevel: nextLevel, thresholdPaid, discretionaryPoints: 1, classGrowth, respecMilestone });
  }
  const discardedXp = nextLevel === 42 ? remainder : 0;
  const finalXp = nextLevel === 42 ? 0 : remainder;
  return {
    kind: 'calculated',
    transition: {
      contractVersion: PROGRESSION_CONTRACT_VERSION, rulesVersion: PROGRESSION_RULES_VERSION,
      before: { level, xp }, after: { level: nextLevel, xp: finalXp },
      offeredXp, appliedXp: offeredXp - discardedXp, discardedXp, thresholdsPaid,
      nextThreshold: nextLevel === 42 ? null : getXpForLevel(nextLevel),
      discretionaryPointsGranted: crossedLevels.length, permanentStatDeltas, capturedClass,
      crossedLevels, respecMilestonesGranted,
    },
  };
}
