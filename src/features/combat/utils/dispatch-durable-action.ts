/**
 * dispatch-durable-action.ts — durable-intent step of an ability dispatch.
 *
 * The bug this exists to prevent: `submit_combat_action` used to be fired and
 * forgotten, so a `combat-tick` request could reach the server *before* the
 * durable `combat_actions` row and its `join_encounter_engagement()` existed.
 * For an out-of-combat opener there was no engagement either, so the tick
 * resolved without the action and combat never began.
 *
 * Therefore: the submission is awaited here, retried with the SAME action id
 * (the RPC is idempotent by id), and only a durably accepted submission may
 * wake a tick. A definitive failure abandons the tracker entry — it is not a
 * committed `rejected` outcome, because no committed tick ever saw it.
 *
 * Pure: no React, no Supabase import. Everything is injected.
 */
import type { PendingActionTracker } from './pending-actions';

export interface DurableSubmitArgs {
  actionId: string;
  characterId: string;
  abilityKey: string;
  targetCreatureId: string | null;
  clientSeq: number;
}

export interface DispatchDeps {
  tracker: PendingActionTracker;
  /** Awaited durable submission. Must be idempotent by `actionId`. */
  submit: (args: DurableSubmitArgs) => Promise<{ error: { message: string } | null }>;
  /** Max attempts for transient failures (same action id each time). */
  attempts?: number;
}

export interface DispatchResult {
  ok: boolean;
  /** True when a durably accepted action must wake the first tick itself. */
  openerWake: boolean;
  error?: string;
}

const TRANSIENT = ['failed to fetch', 'network', 'timeout', '503', 'temporarily unavailable'];

export function isTransientSubmitError(message: string): boolean {
  const m = message.toLowerCase();
  return TRANSIENT.some(p => m.includes(p));
}

/**
 * Registers the action as pending, then awaits durable submission. Returns only
 * after the action (and its engagement) are durably visible, or after a
 * definitive failure has been cleaned up.
 */
export async function dispatchDurableAction(
  args: DurableSubmitArgs & { label: string; isOpener: boolean; submittedAtTick: number },
  deps: DispatchDeps,
): Promise<DispatchResult> {
  const attempts = deps.attempts ?? 3;
  deps.tracker.submit({
    actionId: args.actionId,
    abilityKey: args.abilityKey,
    label: args.label,
    clientSeq: args.clientSeq,
    submittedAtTick: args.submittedAtTick,
  });

  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { error } = await deps.submit({
      actionId: args.actionId,
      characterId: args.characterId,
      abilityKey: args.abilityKey,
      targetCreatureId: args.targetCreatureId,
      clientSeq: args.clientSeq,
    });
    lastError = error ?? null;
    if (!lastError) return { ok: true, openerWake: args.isOpener };
    if (!isTransientSubmitError(lastError.message)) break;
  }

  deps.tracker.abandon(args.actionId);
  return { ok: false, openerWake: false, error: lastError?.message ?? 'submit failed' };
}
