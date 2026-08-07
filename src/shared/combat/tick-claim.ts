/**
 * tick-claim.ts — client-side contract for the encounter tick claim/commit RPCs.
 *
 * The authority lives in Postgres (`claim_encounter_tick` /
 * `commit_encounter_tick`). This module only types and interprets their
 * results so the edge-function resolver loop, and the tests that model the
 * state machine, agree on one vocabulary.
 *
 * Ownership rules encoded here:
 * - A caller declares which modes it can execute. A claim for a mode it cannot
 *   execute must be refused WITHOUT capturing a lease.
 * - Every granted claim (new or reclaimed after lease expiry) carries a unique
 *   claim token. A commit is only valid with the current token.
 */

export type TickMode = 'live' | 'effects_only';

/** `combat-tick` resolves player and creature actions. */
export const LIVE_MODES: readonly TickMode[] = ['live'];
/** `combat-catchup` only advances offscreen effects. */
export const EFFECTS_ONLY_MODES: readonly TickMode[] = ['effects_only'];

export type ClaimRefusal =
  | 'no_encounter'
  | 'in_flight'
  | 'not_due'
  | 'mode_refused';

export type CommitRefusal = 'no_encounter' | 'already_committed' | 'stale_claim';

export interface ClaimGranted {
  claimed: true;
  tick: number;
  mode: TickMode;
  claim_token: string;
  attempt: number;
  reclaimed: boolean;
}

export interface ClaimRefused {
  claimed: false;
  reason: ClaimRefusal;
  mode?: TickMode | null;
}

export type ClaimResult = ClaimGranted | ClaimRefused;

export interface CommitCommitted {
  committed: true;
  tick: number;
  batch_id: string;
}

export interface CommitRefused {
  committed: false;
  reason: CommitRefusal;
  tick_number?: number;
}

export type CommitResult = CommitCommitted | CommitRefused;

export function isClaimGranted(r: ClaimResult): r is ClaimGranted {
  return r.claimed === true;
}

export function isCommitted(r: CommitResult): r is CommitCommitted {
  return r.committed === true;
}

/** A resolver may only hold a lease for a mode it can actually execute. */
export function supportsMode(mode: TickMode, supported: readonly TickMode[]): boolean {
  return supported.includes(mode);
}

/**
 * Should the caller stop looping? Refusals are all terminal for this
 * invocation: another resolver owns the tick, it is not due, or the derived
 * mode belongs to the other endpoint.
 */
export function shouldStopLoop(r: ClaimResult): boolean {
  return !isClaimGranted(r);
}

/**
 * How `combat-catchup` interprets its own claim attempt.
 *
 * Catch-up declares only `effects_only`. Three outcomes exist:
 *
 * - `resolve` — the claim is held. Catch-up owns this logical tick and must
 *   commit it (publishing its batch) when done.
 * - `skip` — another resolver owns the tick, live combat owns the encounter
 *   (`mode_refused`), or the tick is not due. No lease was captured and no
 *   state may be mutated; the caller returns fresh creature state only.
 * - `unclaimed` — this encounter has no encounter row, or the RPC failed.
 *   Catch-up falls back to unclaimed reconciliation, which is idempotent.
 */
export type EffectsOnlyDecision =
  | { action: 'resolve'; claim: ClaimGranted }
  | { action: 'skip'; reason: Extract<ClaimRefusal, 'in_flight' | 'not_due' | 'mode_refused'> }
  | { action: 'unclaimed'; reason: 'no_encounter' | 'claim_error' };

export function interpretEffectsOnlyClaim(
  result: ClaimResult | null | undefined,
): EffectsOnlyDecision {
  if (!result) return { action: 'unclaimed', reason: 'claim_error' };
  if (isClaimGranted(result)) return { action: 'resolve', claim: result };
  switch (result.reason) {
    case 'in_flight':
    case 'not_due':
    case 'mode_refused':
      return { action: 'skip', reason: result.reason };
    case 'no_encounter':
      return { action: 'unclaimed', reason: 'no_encounter' };
    default:
      return { action: 'unclaimed', reason: 'claim_error' };
  }
}
