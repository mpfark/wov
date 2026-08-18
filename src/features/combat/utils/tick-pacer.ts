/**
 * tick-pacer.ts — the single pacing authority for live combat requests.
 *
 * Why this module exists
 * ----------------------
 * Live combat used to be paced by a repeating 2s worker interval that four
 * different call sites re-armed independently (combat start, ability dispatch,
 * engage broadcast, cadence re-phase). The database, meanwhile, marks a tick due
 * on its own boundary. Two independent clocks with the same period alias: a
 * request that lands a few tens of milliseconds before the boundary is refused
 * `not_due`, and the interval that fired it then waits its own full period. The
 * deployed measurement of that defect was a 2.906s median committed cadence
 * against a 2.0s simulation cadence, with a third of all requests refused.
 *
 * The fix is to stop having a client-owned period at all. The server reports,
 * with every claim answer, its own clock (`nowMs`) and the epoch-ms boundary at
 * which the next tick becomes due (`nextDueAtMs`). This module converts that
 * pair into the delay for exactly one next request. There is never more than one
 * timer, and its target is always the authoritative boundary.
 *
 * Everything here is pure so the scheduling behaviour is deterministic and
 * testable without a browser, a worker, or a network.
 */

/** The intended simulation cadence. Only a fallback when the server is silent. */
export const TICK_RATE_MS = 2000;

/**
 * Added to the server boundary before firing.
 *
 * The boundary is a strict `now >= due` comparison on the server, so aiming
 * exactly at it converts any positive clock or transport skew into a `not_due`
 * refusal. A small positive bias costs a few ms of cadence and removes the
 * refusal entirely.
 */
export const BOUNDARY_BUFFER_MS = 45;

/** Never busy-loop, even if the server reports a boundary already in the past. */
export const MIN_DELAY_MS = 50;

/** Never park longer than this without asking the server again. */
export const MAX_DELAY_MS = TICK_RATE_MS * 2;

/**
 * Fraction of the measured round trip that elapsed between the server sampling
 * its clock and the browser receiving the answer.
 *
 * `serverNowMs` is stamped inside `claim_encounter_tick`, i.e. early in server
 * processing, so most of the round trip (resolve + commit + downstream
 * transport) happens *after* the sample. Ignoring it is what re-introduces the
 * round trip into every interval. Overestimating only costs a cheap `not_due`
 * refusal, which now carries an accurate boundary and self-corrects; under-
 * estimating permanently inflates the cadence.
 */
export const TRANSIT_SHARE = 0.6;

/** Transit compensation is capped so one pathological response cannot busy-loop. */
export const MAX_TRANSIT_COMP_MS = 1200;

/**
 * What the client knows about the server's schedule, learned from the last
 * claim answer (granted or refused — both carry it).
 */
export interface ServerCadence {
  /** Server epoch-ms at which the next tick becomes due. */
  nextDueAtMs: number;
  /**
   * Server epoch-ms when it produced that answer. Used to express the boundary
   * as a *remaining duration*, which is immune to client/server clock offset.
   */
  nowMs: number | null;
  /** Measured client round-trip of the request that carried this report. */
  rttMs?: number | null;
}

export interface PacerInput {
  /** Most recent server cadence report, or null when none is known yet. */
  cadence: ServerCadence | null;
  /** Client clock when the response carrying `cadence` was received. */
  receivedAtMs: number;
  /** Client clock now. */
  nowMs: number;
  /** Fallback period when the server has not reported a boundary. */
  rateMs?: number;
}

/**
 * Delay (ms) until the next `combat-tick` request should be submitted.
 *
 * Derived from the *remaining* time the server reported, not from comparing a
 * server timestamp against the client clock: `nextDueAtMs - nowMs` is a
 * duration measured entirely on the server, so a client whose clock is minutes
 * off still paces correctly.
 */
export function nextTickDelayMs(input: PacerInput): number {
  const rate = input.rateMs ?? TICK_RATE_MS;
  const { cadence } = input;
  if (!cadence || !Number.isFinite(cadence.nextDueAtMs)) {
    return clamp(rate, rate);
  }
  const serverNow = Number.isFinite(cadence.nowMs as number)
    ? (cadence.nowMs as number)
    : cadence.nextDueAtMs - rate;
  const remainingAtSample = cadence.nextDueAtMs - serverNow;
  // Time already spent on the client since that answer arrived counts against
  // the wait, otherwise slow local work is added on top of the cadence.
  const elapsedSinceReceipt = Math.max(0, input.nowMs - input.receivedAtMs);
  const rtt = Number.isFinite(cadence.rttMs as number) ? Math.max(0, cadence.rttMs as number) : 0;
  const transit = Math.min(MAX_TRANSIT_COMP_MS, Math.round(rtt * TRANSIT_SHARE));
  return clamp(
    remainingAtSample - transit - elapsedSinceReceipt + BOUNDARY_BUFFER_MS,
    rate,
  );
}

function clamp(delay: number, rateMs: number): number {
  const max = Math.max(MIN_DELAY_MS, rateMs * 2);
  if (!Number.isFinite(delay)) return rateMs;
  return Math.min(max, Math.max(MIN_DELAY_MS, Math.round(delay)));
}


/**
 * Reads the cadence report out of an already-classified tick acknowledgement.
 * Returns null when the answer carried no schedule (transport error, legacy
 * payload), which makes the caller fall back to the nominal rate.
 */
export function readServerCadence(
  ack: { nextDueAtMs?: number | null; serverNowMs?: number | null } | null | undefined,
  rttMs?: number | null,
): ServerCadence | null {
  const due = ack?.nextDueAtMs;
  if (typeof due !== 'number' || !Number.isFinite(due) || due <= 0) return null;
  const now = ack?.serverNowMs;
  return {
    nextDueAtMs: due,
    nowMs: typeof now === 'number' && Number.isFinite(now) && now > 0 ? now : null,
    rttMs: typeof rttMs === 'number' && Number.isFinite(rttMs) && rttMs >= 0 ? rttMs : null,
  };
}

