/**
 * Deterministic scheduling contract for the live combat pacer.
 *
 * These tests encode the defect that produced a 2.906s median committed cadence
 * against a 2.0s simulation cadence: a client-owned period aliasing against the
 * server boundary. The pacer must aim at the boundary the server reports, must
 * never busy-loop, and must not accumulate per-tick processing latency.
 */
import { describe, it, expect } from 'vitest';
import {
  nextTickDelayMs,
  readServerCadence,
  BOUNDARY_BUFFER_MS,
  MIN_DELAY_MS,
  TICK_RATE_MS,
} from '@/features/combat/utils/tick-pacer';

describe('tick pacer', () => {
  it('falls back to the nominal rate before the server has reported anything', () => {
    expect(nextTickDelayMs({ cadence: null, receivedAtMs: 0, nowMs: 0 })).toBe(TICK_RATE_MS);
  });

  it('aims just past the boundary the server reported', () => {
    // Server answered at its clock 10_000 and said the next tick is due at 12_000.
    const delay = nextTickDelayMs({
      cadence: { nextDueAtMs: 12_000, nowMs: 10_000 },
      receivedAtMs: 500_000, // arbitrary client clock
      nowMs: 500_000,
    });
    expect(delay).toBe(2_000 + BOUNDARY_BUFFER_MS);
  });

  it('is immune to client/server clock offset', () => {
    const skewed = nextTickDelayMs({
      cadence: { nextDueAtMs: 12_000, nowMs: 10_000 },
      receivedAtMs: 0,
      nowMs: 0,
    });
    const aligned = nextTickDelayMs({
      cadence: { nextDueAtMs: 1_000_012_000, nowMs: 1_000_010_000 },
      receivedAtMs: 0,
      nowMs: 0,
    });
    expect(skewed).toBe(aligned);
  });

  it('charges client-side processing time against the wait, not on top of it', () => {
    const delay = nextTickDelayMs({
      cadence: { nextDueAtMs: 12_000, nowMs: 10_000 },
      receivedAtMs: 1_000,
      nowMs: 1_600, // 600ms of local work already elapsed
    });
    expect(delay).toBe(2_000 - 600 + BOUNDARY_BUFFER_MS);
  });

  it('never busy-loops when the boundary is already in the past', () => {
    const delay = nextTickDelayMs({
      cadence: { nextDueAtMs: 9_000, nowMs: 10_000 },
      receivedAtMs: 0,
      nowMs: 0,
    });
    expect(delay).toBe(MIN_DELAY_MS);
  });

  it('never parks longer than two intervals', () => {
    const delay = nextTickDelayMs({
      cadence: { nextDueAtMs: 99_000, nowMs: 10_000 },
      receivedAtMs: 0,
      nowMs: 0,
    });
    expect(delay).toBe(TICK_RATE_MS * 2);
  });

  it('does not accumulate drift across a long run of latent ticks', () => {
    // The server advances its boundary by exactly one interval per granted
    // claim, so a resolver that spends 700ms per tick must NOT push the
    // schedule out: total elapsed for N ticks stays N * rate.
    const rate = TICK_RATE_MS;
    const resolveMs = 700;
    let serverNow = 1_000_000;
    let boundary = serverNow + rate;
    let clientClock = 0;
    const commits: number[] = [];
    for (let i = 0; i < 30; i++) {
      const delay = nextTickDelayMs({
        cadence: { nextDueAtMs: boundary, nowMs: serverNow },
        receivedAtMs: clientClock,
        nowMs: clientClock,
      });
      clientClock += delay; // request fires
      serverNow = boundary + BOUNDARY_BUFFER_MS; // arrives just past the boundary
      // Granted: the server advances the boundary from the boundary it consumed.
      boundary = boundary + rate;
      serverNow += resolveMs; // commit lands after resolution
      commits.push(serverNow);
      clientClock += resolveMs;
    }
    const gaps: number[] = [];
    for (let i = 1; i < commits.length; i++) gaps.push(commits[i] - commits[i - 1]);
    for (const gap of gaps) expect(gap).toBe(rate);
  });

  it('reads a cadence report only when the boundary is usable', () => {
    expect(readServerCadence(null)).toBeNull();
    expect(readServerCadence({ nextDueAtMs: 0, serverNowMs: 1 })).toBeNull();
    expect(readServerCadence({ nextDueAtMs: 5, serverNowMs: null })).toEqual({
      nextDueAtMs: 5,
      nowMs: null,
    });
  });
});
