/**
 * The cadence transport contract.
 *
 * The deployed failure was not a bad delay calculation: the server computed the
 * authoritative boundary and its own clock, and then dropped both on the floor
 * for successful ticks. A client that only learns "2000 ms" schedules from
 * response receipt, which adds the whole round trip to every interval (measured
 * 3.687s median commit gap against a 2.0s cadence). These tests pin the two
 * fields end to end: claim answer -> orchestration envelope -> client ack ->
 * pacer delay.
 */
import { describe, it, expect } from 'vitest';

import { readClaimCadence } from '@/shared/combat/c3/orchestration';
import { interpretTickAck } from '@/features/combat/utils/tick-ack';
import { nextTickDelayMs, readServerCadence } from '@/features/combat/utils/tick-pacer';

const GRANT = {
  claimed: true,
  tick: 12,
  mode: 'live',
  claim_token: 'tok',
  resolver_id: 'res',
  now_ms: 1_700_000_000_000,
  boundary_at_ms: 1_700_000_000_000,
  next_due_at_ms: 1_700_000_002_000,
};

describe('cadence transport — claim answer', () => {
  it('reads clock, reserved boundary and next boundary from a grant', () => {
    expect(readClaimCadence(GRANT)).toEqual({
      serverNowMs: 1_700_000_000_000,
      boundaryAtMs: 1_700_000_000_000,
      nextDueAtMs: 1_700_000_002_000,
    });
  });

  it('reads them from a not_due refusal too', () => {
    expect(readClaimCadence({
      claimed: false,
      reason: 'not_due',
      now_ms: 1_700_000_000_500,
      boundary_at_ms: 1_700_000_002_000,
      next_due_at_ms: 1_700_000_002_000,
    })).toEqual({
      serverNowMs: 1_700_000_000_500,
      boundaryAtMs: 1_700_000_002_000,
      nextDueAtMs: 1_700_000_002_000,
    });
  });

  it('never invents a zero clock when the server omits one', () => {
    expect(readClaimCadence({ claimed: false, reason: 'mode_refused' })).toEqual({
      serverNowMs: null,
      boundaryAtMs: null,
      nextDueAtMs: null,
    });
  });
});

describe('cadence transport — committed envelope', () => {
  // Post-commit pacing: the clock is sampled inside the commit transaction and
  // the server also reports how long it spent between answering the claim and
  // that sample, so the client can subtract measured network time instead of a
  // guessed fraction of the round trip.
  const envelope = {
    ok: true,
    encounterId: 'enc',
    tick: 12,
    batchId: 'batch',
    ticksProcessed: 1,
    nextDueAtMs: GRANT.next_due_at_ms,
    serverNowMs: GRANT.now_ms + 700,
    serverProcessMs: 700,
  };

  it('carries the post-commit cadence through to the client acknowledgement', () => {
    const ack = interpretTickAck(envelope);
    expect(ack.kind).toBe('committed');
    expect(ack.kind === 'committed' && ack.nextDueAtMs).toBe(GRANT.next_due_at_ms);
    expect(ack.kind === 'committed' && ack.serverNowMs).toBe(GRANT.now_ms + 700);
    expect(ack.kind === 'committed' && ack.serverProcessMs).toBe(700);
  });

  it('paces from the committed boundary, not from response receipt', () => {
    // Round trip 1.6s of which 0.7s was measured server work: 0.9s is network.
    // The boundary is 1.3s after the commit sample, so only that remainder
    // minus the measured network time may be waited. Scheduling a full 2.0s
    // here is exactly the 3.6s cadence that was measured live.
    const ack = interpretTickAck(envelope);
    const cadence = readServerCadence(
      ack.kind === 'committed' ? ack : null,
      1_600,
    );
    const delay = nextTickDelayMs({
      cadence,
      receivedAtMs: 10_000,
      nowMs: 10_000,
    });
    // 1300 remaining - 900 network + 45 buffer
    expect(delay).toBe(445);
    expect(delay).toBeLessThan(2_000);
  });

  it('classifies a refusal and still adopts its boundary', () => {
    const ack = interpretTickAck({
      ok: false,
      kind: 'claim_refused',
      reason: 'not_due',
      detail: { mode: 'live', nextDueAtMs: 1_700_000_002_000, serverNowMs: 1_700_000_000_500 },
    });
    expect(ack.kind === 'refused' && ack.terminal).toBe(false);
    expect(ack.kind === 'refused' && ack.reason).toBe('not_due');
    // A refusal does no work, so its processing span is zero by construction.
    expect(ack.kind === 'refused' && ack.serverProcessMs).toBe(0);
    const cadence = readServerCadence(ack.kind === 'refused' ? ack : null, 300);
    expect(nextTickDelayMs({ cadence, receivedAtMs: 0, nowMs: 0 })).toBe(1_500 - 300 + 45);
  });

  it('falls back to the nominal rate only when the envelope is silent', () => {
    const ack = interpretTickAck({ ok: true, encounterId: 'e', tick: 1, batchId: 'b' });
    expect(nextTickDelayMs({
      cadence: readServerCadence(ack.kind === 'committed' ? ack : null),
      receivedAtMs: 0,
      nowMs: 0,
    })).toBe(2_000);
  });
});

