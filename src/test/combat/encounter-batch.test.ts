import { describe, it, expect } from 'vitest';

import {
  EncounterBatchSequencer,
  batchToTickResponse,
  type EncounterBatchRow,
} from '@/features/combat/utils/encounter-batch';

const row = (tick: number, id = `b${tick}`): EncounterBatchRow => ({
  batch_id: id,
  encounter_id: 'enc',
  tick_number: tick,
  payload: { events: [], creature_states: [], member_states: [], ticks_processed: 1 },
});

describe('EncounterBatchSequencer', () => {
  it('applies consecutive batches in order', () => {
    const s = new EncounterBatchSequencer();
    expect(s.ingest(row(5)).ready.map(r => r.tick_number)).toEqual([5]);
    expect(s.ingest(row(6)).ready.map(r => r.tick_number)).toEqual([6]);
  });

  it('drops duplicates by batch id and by already-applied tick', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    expect(s.ingest(row(1)).ready).toEqual([]);
    expect(s.ingest(row(1, 'other-id')).ready).toEqual([]);
  });

  it('buffers out-of-order arrivals and reports the gap', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    const out = s.ingest(row(4));
    expect(out.ready).toEqual([]);
    expect(out.gap).toEqual({ fromTick: 2, toTick: 3 });
    const recovered = s.ingest([row(2), row(3)]);
    expect(recovered.ready.map(r => r.tick_number)).toEqual([2, 3, 4]);
    expect(recovered.gap).toBeNull();
  });

  it('skips realtime copies of ticks already applied on the fast path', () => {
    const s = new EncounterBatchSequencer();
    s.markApplied(7, 'b7');
    expect(s.ingest(row(7)).ready).toEqual([]);
    expect(s.nextExpectedTick).toBe(8);
  });

  it('resets between encounters', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(9));
    s.reset();
    expect(s.ingest(row(1)).ready.map(r => r.tick_number)).toEqual([1]);
  });

  it('rejects payloads that are not tick results', () => {
    expect(batchToTickResponse({ ...row(1), payload: null })).toBeNull();
    expect(batchToTickResponse({ ...row(1), payload: { foo: 1 } })).toBeNull();
    const ok = batchToTickResponse(row(3));
    expect(ok?.encounter_tick).toBe(3);
    expect(ok?.encounter_batch_id).toBe('b3');
  });
});
