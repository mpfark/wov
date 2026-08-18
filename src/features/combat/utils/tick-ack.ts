/**
 * tick-ack.ts — the client-side reader of the C3 orchestration response.
 *
 * `combat-tick` no longer returns a renderable tick. Since C3 it answers with
 * the orchestration envelope:
 *
 *   success  { ok: true,  encounterId, tick, mode, batchId, ticksProcessed, ... }
 *   refusal  { ok: false, kind, reason, retryable?, detail? }
 *
 * The client used to read only the pre-C3 snake_case payload
 * (`encounter_id`, `encounter_batch_id`, `session_ended`, ...). None of those
 * fields exist in the envelope, so every acknowledgement silently degraded to
 * "nothing happened": the encounter identity was never adopted (so the
 * committed-batch stream was never subscribed to), a maintenance refusal was
 * never latched, and a terminal encounter was never recognised — which is how
 * a client kept ticking against a corpse forever.
 *
 * This module is pure: it classifies one raw response. It never renders — only
 * committed batches render (C4). Its job is identity, refusal and termination.
 */

import { isMaintenanceResponse } from '@/shared/combat/maintenance';

export type TickAck =
  /** Combat is globally closed. Latch it and stop. */
  | { kind: 'maintenance'; message?: string }
  /**
   * The tick was committed. Carries the identity the batch stream needs.
   * Nothing here is rendered.
   */
  | {
      kind: 'committed';
      encounterId: string | null;
      tick: number | null;
      batchId: string | null;
      ticksProcessed: number;
      /** Server boundary for the next tick (pacing authority). */
      nextDueAtMs: number | null;
      /** Server clock when it produced this answer. */
      serverNowMs: number | null;
    }
  /**
   * The server refused. `terminal` means this encounter can never produce
   * another live tick for us, so the driver must leave combat instead of
   * retrying (otherwise `encounter_intake` keeps minting idle encounters).
   */
  | {
      kind: 'refused';
      reason: string;
      failureKind: string;
      terminal: boolean;
      /**
       * Server clock (ms) at which this encounter's next tick becomes due.
       * Present on cadence refusals (`not_due` / `in_flight`) so the client can
       * pace onto the authoritative boundary instead of aliasing against it (a
       * client-owned 2s period that lands just before a 2s boundary waits a
       * whole extra interval, which is what turned a 2s simulation cadence into
       * a ~2.9s committed cadence).
       */
      nextDueAtMs: number | null;
      /** Server clock when it produced this answer. */
      serverNowMs: number | null;
    }

  /** Pre-C3 snake_case payload — the caller keeps its legacy handling. */
  | { kind: 'legacy' }
  /** No parseable body at all. */
  | { kind: 'unknown' };

/**
 * Refusals that mean "there is nothing live left here for this caller".
 *
 * `mode_refused` with an `effects_only` claim is the authoritative
 * end-of-combat signal on the acknowledgement path: the database offers only a
 * catch-up tick precisely because no creature is engaged any more.
 */
function isTerminalRefusal(failureKind: string, reason: string, detailMode: string | null): boolean {
  if (failureKind === 'no_encounter') return true;
  if (failureKind === 'unauthorized' || failureKind === 'invalid_request') return true;
  if (failureKind === 'claim_refused') {
    if (reason === 'mode_refused' && detailMode === 'effects_only') return true;
    if (reason === 'no_encounter' || reason === 'encounter_ended') return true;
  }
  return false;
}

export function interpretTickAck(raw: unknown): TickAck {
  if (!raw || typeof raw !== 'object') return { kind: 'unknown' };
  const data = raw as Record<string, any>;

  // Legacy gated payload (`maintenance: true`) and the C3 refusal kind.
  if (isMaintenanceResponse(data) || (data.ok === false && data.kind === 'maintenance')) {
    const message = typeof data.message === 'string' && data.message.length > 0
      ? data.message
      : typeof data.reason === 'string' && data.reason.length > 0
        ? data.reason
        : undefined;
    return { kind: 'maintenance', message };
  }

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

  if (data.ok === true) {
    return {
      kind: 'committed',
      encounterId: typeof data.encounterId === 'string' ? data.encounterId : null,
      tick: typeof data.tick === 'number' ? data.tick : null,
      batchId: typeof data.batchId === 'string' ? data.batchId : null,
      ticksProcessed: typeof data.ticksProcessed === 'number' ? data.ticksProcessed : 0,
      nextDueAtMs: num(data.nextDueAtMs),
      serverNowMs: num(data.serverNowMs),
    };
  }

  if (data.ok === false) {
    const failureKind = typeof data.kind === 'string' ? data.kind : 'internal';
    const reason = typeof data.reason === 'string' ? data.reason : 'refused';
    const detailMode = typeof data.detail?.mode === 'string' ? data.detail.mode : null;
    return {
      kind: 'refused',
      reason,
      failureKind,
      terminal: isTerminalRefusal(failureKind, reason, detailMode),
      nextDueAtMs: num(data.detail?.nextDueAtMs),
      serverNowMs: num(data.detail?.serverNowMs),
    };
  }


  // Pre-C3 renderable payload (still produced by committed batches and party
  // broadcasts).
  if (Array.isArray(data.events) || Array.isArray(data.creature_states)) return { kind: 'legacy' };
  return { kind: 'unknown' };
}

/**
 * Classify a transport-level failure of `combat-tick`. A 400/401/403 is the
 * caller's own fault and will repeat forever, so it must terminate the local
 * combat state rather than retry on cadence.
 */
export function isTerminalTransportStatus(status: number | null | undefined): boolean {
  return status === 400 || status === 401 || status === 403;
}
