/**
 * opener-gates.ts — the pacing/eligibility predicates a durably submitted
 * out-of-combat opener depends on, plus the pending-pulse projection.
 *
 * These are the exact expressions `useCombatDriver` evaluates, extracted so the
 * failure they fix can be pinned deterministically:
 *
 *   queueAbility → doTick consumes `pendingAbilityRef` → durable submission
 *   succeeds → the first `combat-tick` legitimately answers `not_due` /
 *   `in_flight` → the pacer used to see neither combat nor a queued ability and
 *   stopped re-arming, stranding a durable action that nobody would ever wake.
 *
 * A durable opener is therefore first-class pending work: it keeps the pacer
 * alive, keeps this client eligible to fire the tick that resolves it, and never
 * creates a second action id.
 *
 * Pure: no React, no Supabase, no timers.
 */

export interface PendingWorkState {
  inCombat: boolean;
  /** Local queue entry that has not been dispatched yet. */
  hasQueuedAbility: boolean;
  /** Durably submitted opener with no committed outcome yet. */
  hasDurableOpener: boolean;
}

/** True when the single authoritative pacer must arm another wake. */
export function shouldPaceNextTick(s: PendingWorkState): boolean {
  return s.inCombat || s.hasQueuedAbility || s.hasDurableOpener;
}

/**
 * True when this driver may actually issue the `combat-tick` request. An
 * unresolved durable opener counts as work even while the client is out of
 * combat and carries no local cast marker for this pass.
 */
export function shouldIssueTickRequest(args: {
  driver: boolean;
  alive: boolean;
  engagedCount: number;
  localCastCount: number;
  hasDurableOpener: boolean;
}): boolean {
  if (!args.driver || !args.alive) return false;
  return args.engagedCount > 0 || args.localCastCount > 0 || args.hasDurableOpener;
}

export type PendingPulseStage = 'preparing' | 'submitted';

export interface PendingPulse {
  index: number | null;
  stage: PendingPulseStage | null;
}

/**
 * One continuous visual state across the pre-dispatch queue and the durable
 * tracker, so the pulse never flickers between them. Feedback only.
 */
export function pendingPulse(args: {
  queuedIndex?: number | null;
  durableSlotIndex?: number | null;
}): PendingPulse {
  if (args.queuedIndex !== null && args.queuedIndex !== undefined) {
    return { index: args.queuedIndex, stage: 'preparing' };
  }
  if (args.durableSlotIndex !== null && args.durableSlotIndex !== undefined) {
    return { index: args.durableSlotIndex, stage: 'submitted' };
  }
  return { index: null, stage: null };
}
