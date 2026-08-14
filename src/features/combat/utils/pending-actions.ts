/**
 * pending-actions.ts — C4: durable action acknowledgement.
 *
 * A dispatched ability is written to `combat_actions` (durable intent) and then
 * lives in exactly three client states:
 *
 *   submitted → durably acknowledged / pending → consumed | rejected | superseded
 *
 * The ONLY thing that may leave the pending state is a *committed* tick batch:
 * the HTTP response of `combat-tick` and the party broadcast are
 * acknowledgements of a tick number, never of an action. That is what makes a
 * lost HTTP response harmless — the durable row still resolves on the server and
 * the committed batch tells every tab the same outcome.
 *
 * Matching is by stable `action_id`. Ability keys and arrival order are never
 * used, so two casts of the same ability can never acknowledge each other.
 *
 * Pure: no React, no Supabase.
 */

/** Authoritative rejection reasons produced by the pure resolver. */
export type ActionRejectionReason =
  | 'no_target'
  | 'target_dead'
  | 'caster_dead'
  | 'insufficient_cp'
  | 'insufficient_hp'
  | string;

export interface SubmittedAction {
  readonly actionId: string;
  readonly abilityKey: string;
  readonly label: string;
  readonly clientSeq: number;
  /**
   * Highest committed tick the client knew about when the action was submitted.
   * A batch for a tick at or below this cannot have seen the action, so it can
   * never clear it. This is what keeps an action submitted *after* the
   * resolver's snapshot pending instead of silently vanishing.
   */
  readonly submittedAtTick: number;
}

export type ActionOutcomeKind = 'consumed' | 'rejected' | 'superseded';

export interface ActionOutcome {
  readonly actionId: string;
  readonly kind: ActionOutcomeKind;
  readonly tick: number;
  readonly label: string;
  readonly abilityKey: string;
  readonly reason?: ActionRejectionReason;
}

export interface CommittedActionOutcomes {
  readonly batchId: string;
  readonly tick: number;
  readonly consumedActionIds: readonly string[];
  readonly rejectedActions: readonly { actionId: string; reason: ActionRejectionReason }[];
}

interface Entry {
  readonly action: SubmittedAction;
  /** Set when a newer local action replaced this one before it resolved. */
  superseded: boolean;
}

/** Concise, presentation-ready copy for a rejection. Reused by log + toast. */
export function describeRejection(reason: ActionRejectionReason): string {
  switch (reason) {
    case 'no_target': return 'no valid target';
    case 'target_dead': return 'the target was already dead';
    case 'caster_dead': return 'you were down';
    case 'insufficient_cp': return 'not enough CP';
    case 'insufficient_hp': return 'not enough HP to pay the cost';
    default: return reason.replace(/_/g, ' ');
  }
}

const MAX_LEDGER = 400;

export class PendingActionTracker {
  private entries = new Map<string, Entry>();
  /** Batch ids already applied — duplicate delivery must not re-acknowledge. */
  private seenBatches = new Set<string>();
  /**
   * Terminal outcome per action id as published by committed batches, including
   * ids this tab never submitted. Two tabs fed the same committed batches hold
   * identical ledgers, which is the convergence guarantee.
   */
  private ledger = new Map<string, { kind: ActionOutcomeKind; tick: number; reason?: ActionRejectionReason }>();

  reset(): void {
    this.entries.clear();
    this.seenBatches.clear();
    this.ledger.clear();
  }

  /**
   * Record a locally dispatched action. Any still-pending action is marked
   * superseded: the server may still execute it (then it reports `consumed`), so
   * it stays tracked and is only reported as `superseded` once a later committed
   * tick proves it was not executed.
   */
  submit(action: SubmittedAction): void {
    for (const entry of this.entries.values()) entry.superseded = true;
    this.entries.set(action.actionId, { action, superseded: false });
  }

  /** Actions still awaiting a committed outcome (newest last). */
  pending(): SubmittedAction[] {
    return [...this.entries.values()].filter(e => !e.superseded).map(e => e.action);
  }

  get pendingCount(): number {
    return this.pending().length;
  }

  outcomeOf(actionId: string): { kind: ActionOutcomeKind; tick: number; reason?: ActionRejectionReason } | undefined {
    return this.ledger.get(actionId);
  }

  /** Snapshot of the committed ledger — used by convergence assertions/tests. */
  ledgerEntries(): [string, { kind: ActionOutcomeKind; tick: number; reason?: ActionRejectionReason }][] {
    return [...this.ledger.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  /**
   * Apply the action section of one committed batch. Returns the outcomes for
   * locally tracked actions, each emitted exactly once. Idempotent per batch id.
   */
  applyCommitted(batch: CommittedActionOutcomes): ActionOutcome[] {
    if (this.seenBatches.has(batch.batchId)) return [];
    this.seenBatches.add(batch.batchId);
    if (this.seenBatches.size > MAX_LEDGER) {
      this.seenBatches = new Set([...this.seenBatches].slice(-Math.floor(MAX_LEDGER / 2)));
    }

    const out: ActionOutcome[] = [];

    const resolve = (actionId: string, kind: ActionOutcomeKind, reason?: ActionRejectionReason) => {
      if (!this.ledger.has(actionId)) {
        this.ledger.set(actionId, { kind, tick: batch.tick, ...(reason ? { reason } : {}) });
        this.trimLedger();
      }
      const entry = this.entries.get(actionId);
      if (!entry) return; // foreign action (other tab / other member) — ledger only.
      this.entries.delete(actionId);
      out.push({
        actionId,
        kind,
        tick: batch.tick,
        label: entry.action.label,
        abilityKey: entry.action.abilityKey,
        ...(reason ? { reason } : {}),
      });
    };

    for (const id of batch.consumedActionIds) resolve(id, 'consumed');
    for (const r of batch.rejectedActions) resolve(r.actionId, 'rejected', r.reason);

    // A superseded action that a *later* committed tick did not execute is gone
    // for good: report it as superseded, distinct from an executed action.
    for (const [id, entry] of [...this.entries.entries()]) {
      if (!entry.superseded) continue;
      if (batch.tick <= entry.action.submittedAtTick) continue;
      resolve(id, 'superseded');
    }

    return out;
  }

  /**
   * Authoritative resynchronisation: actions whose batches were pruned can
   * never be acknowledged. Everything submitted at or before the snapshot's
   * tick is closed as superseded; anything newer stays pending.
   */
  reanchor(tick: number): ActionOutcome[] {
    const out: ActionOutcome[] = [];
    for (const [id, entry] of [...this.entries.entries()]) {
      if (entry.action.submittedAtTick >= tick) continue;
      this.entries.delete(id);
      if (!this.ledger.has(id)) this.ledger.set(id, { kind: 'superseded', tick });
      out.push({
        actionId: id,
        kind: 'superseded',
        tick,
        label: entry.action.label,
        abilityKey: entry.action.abilityKey,
      });
    }
    return out;
  }

  private trimLedger(): void {
    if (this.ledger.size <= MAX_LEDGER) return;
    const keys = [...this.ledger.keys()].slice(0, this.ledger.size - Math.floor(MAX_LEDGER / 2));
    for (const k of keys) this.ledger.delete(k);
  }
}
