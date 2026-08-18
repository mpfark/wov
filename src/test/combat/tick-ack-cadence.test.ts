/**
 * The cadence refusal must carry the server's next-due boundary so the client
 * can re-phase instead of aliasing (a fixed 2s poll landing just before a 2s
 * boundary waited a whole extra interval — the S1 3.67s committed cadence).
 */
import { describe, it, expect } from 'vitest';

import { interpretTickAck } from '@/features/combat/utils/tick-ack';

describe('tick ack — cadence boundary', () => {
  it('exposes nextDueAtMs on a not_due refusal', () => {
    const ack = interpretTickAck({
      ok: false,
      kind: 'claim_refused',
      reason: 'not_due',
      detail: { mode: 'live', nextDueAtMs: 1_700_000_000_000 },
    });
    expect(ack).toMatchObject({ kind: 'refused', reason: 'not_due', terminal: false });
    expect(ack.kind === 'refused' && ack.nextDueAtMs).toBe(1_700_000_000_000);
  });

  it('is null when the server does not report a boundary', () => {
    const ack = interpretTickAck({ ok: false, kind: 'internal', reason: 'boom' });
    expect(ack.kind === 'refused' && ack.nextDueAtMs).toBeNull();
  });

  it('never re-phases a terminal refusal', () => {
    const ack = interpretTickAck({
      ok: false,
      kind: 'claim_refused',
      reason: 'encounter_ended',
      detail: { mode: 'live', nextDueAtMs: 123 },
    });
    expect(ack).toMatchObject({ kind: 'refused', terminal: true });
  });
});
