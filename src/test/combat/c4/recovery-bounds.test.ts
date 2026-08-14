/**
 * C4: sequencer recovery bounds vs server retention, and the unrecoverable-gap
 * contract (never silently re-anchor past an unresolved committed tick).
 */
import { describe, expect, it } from 'vitest';

import { EncounterBatchSequencer, type EncounterBatchRow } from '@/features/combat/utils/encounter-batch';

const row = (tick: number): EncounterBatchRow => ({
  batch_id: `b${tick}`,
  encounter_id: 'enc',
  tick_number: tick,
  payload: {},
});

/** 180s retention at the 2s cadence. */
const RETENTION_TICKS = 90;

describe('EncounterBatchSequencer recovery bounds', () => {
  it('can request a recovery window covering the full retention period', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    s.noteCommitted(1 + RETENTION_TICKS + 20);
    const missing = s.missingRange()!;
    expect(missing.fromTick).toBe(2);
    // Retention is 90 ticks; the window must reach past it with margin.
    expect(missing.toTick - missing.fromTick + 1).toBeGreaterThan(RETENTION_TICKS * 2);
    expect(missing.toTick).toBe(1 + RETENTION_TICKS + 20);
  });

  it('buffers more than a retention window of newer ticks without skipping the hole', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    for (let t = 3; t < 3 + RETENTION_TICKS; t++) s.ingest(row(t));
    // Cursor still parked in front of the hole at tick 2.
    expect(s.appliedTick).toBe(1);
    expect(s.missingRange()).toEqual({ fromTick: 2, toTick: 2 });
    expect(s.unrecoverableRange).toBeNull();
    // The hole fills and everything buffered flushes in order.
    const out = s.ingest(row(2));
    expect(out.ready.map(r => r.tick_number)).toEqual(
      Array.from({ length: RETENTION_TICKS + 1 }, (_, i) => 2 + i),
    );
  });

  it('reports an unrecoverable gap instead of silently re-anchoring', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    let outcome = s.ingest([]);
    for (let t = 3; t < 3 + 300; t++) outcome = s.ingest(row(t));
    expect(outcome.unrecoverable).toEqual({ fromTick: 2, toTick: 2 });
    // Crucially: the render cursor did NOT move past tick 1.
    expect(s.appliedTick).toBe(1);
    expect(outcome.ready).toEqual([]);
  });

  it('re-anchors only when told to, and then resumes from later batches', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    for (let t = 3; t < 3 + 300; t++) s.ingest(row(t));
    expect(s.unrecoverableRange).not.toBeNull();

    // Authoritative snapshot says tick 200 is the truth.
    s.reanchorTo(200);
    expect(s.appliedTick).toBe(200);
    expect(s.unrecoverableRange).toBeNull();

    const out = s.ingest(row(201));
    expect(out.ready.map(r => r.tick_number)).toEqual([201]);
    // Pre-snapshot batches can never replay.
    expect(s.ingest(row(150)).ready).toEqual([]);
  });

  it('markUnrecoverable never moves the cursor', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(10));
    s.noteCommitted(14);
    const range = s.markUnrecoverable();
    expect(range).toEqual({ fromTick: 11, toTick: 14 });
    expect(s.appliedTick).toBe(10);
  });
});
