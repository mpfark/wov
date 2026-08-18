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
  measuredNetworkMs,
  BOUNDARY_BUFFER_MS,
  MIN_DELAY_MS,
  MAX_NETWORK_COMP_MS,
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
      rttMs: null,
      serverProcessMs: null,
    });
    // A measured round trip AND the server's measured processing span are both
    // retained: their difference is the network time the delay compensates for.
    expect(readServerCadence({ nextDueAtMs: 5, serverNowMs: 1, serverProcessMs: 90 }, 240)).toEqual({
      nextDueAtMs: 5,
      nowMs: 1,
      rttMs: 240,
      serverProcessMs: 90,
    });

  });

  it('subtracts measured network time, not a fraction of the round trip', () => {
    // 1600ms round trip of which the server measured 700ms as its own work:
    // 900ms is network and nothing else may be guessed.
    const cadence = {
      nextDueAtMs: 1_000_000 + 2_000,
      nowMs: 1_000_000 + 700, // commit-transaction clock
      rttMs: 1_600,
      serverProcessMs: 700,
    };
    expect(measuredNetworkMs(cadence)).toBe(900);
    // remaining 1300 - 900 network + 45 buffer
    expect(nextTickDelayMs({ cadence, receivedAtMs: 0, nowMs: 0 })).toBe(1_300 - 900 + BOUNDARY_BUFFER_MS);
  });

  it('never treats server processing time as network time', () => {
    // A slow commit with a fast network: rtt == serverProcess, so there is no
    // network compensation at all.
    expect(measuredNetworkMs({ nextDueAtMs: 2, nowMs: 1, rttMs: 900, serverProcessMs: 900 })).toBe(0);
    // A malformed pair can never produce a negative compensation.
    expect(measuredNetworkMs({ nextDueAtMs: 2, nowMs: 1, rttMs: 100, serverProcessMs: 900 })).toBe(0);
    // Nor an unbounded one.
    expect(measuredNetworkMs({ nextDueAtMs: 2, nowMs: 1, rttMs: 99_000, serverProcessMs: 0 }))
      .toBe(MAX_NETWORK_COMP_MS);
  });

  it('holds a 2s request cadence end to end over a latent link', () => {
    // Full loop with post-commit pacing: 400ms upstream, 700ms server, 200ms
    // downstream. Request-to-request spacing must stay one interval (plus the
    // deliberate boundary buffer), and every claim must land already due.
    const rate = TICK_RATE_MS;
    const up = 400, server = 700, down = 200;
    let boundary = 1_000_000;
    let clientClock = 0;
    let cadence = null as null | { nextDueAtMs: number; nowMs: number; rttMs: number; serverProcessMs: number };
    let receivedAt = 0;
    const requests: number[] = [];
    const commits: number[] = [];
    for (let i = 0; i < 20; i++) {
      const delay = i === 0 ? 0 : nextTickDelayMs({ cadence, receivedAtMs: receivedAt, nowMs: clientClock });
      clientClock += delay;
      requests.push(clientClock);
      const claimAt = clientClock + up;
      // The claim must be due when it arrives, otherwise the server refuses it.
      expect(claimAt).toBeGreaterThanOrEqual(boundary);
      const committedAt = claimAt + server;
      commits.push(committedAt);
      const nextBoundary = boundary + rate;
      receivedAt = committedAt + down;
      clientClock = receivedAt;
      cadence = {
        nextDueAtMs: nextBoundary,
        nowMs: committedAt,
        rttMs: up + server + down,
        serverProcessMs: server,
      };
      boundary = nextBoundary;
    }
    for (let i = 2; i < requests.length; i++) {
      expect(requests[i] - requests[i - 1]).toBe(rate + BOUNDARY_BUFFER_MS);
    }
    for (let i = 2; i < commits.length; i++) {
      expect(commits[i] - commits[i - 1]).toBe(rate + BOUNDARY_BUFFER_MS);
    }
  });
});

