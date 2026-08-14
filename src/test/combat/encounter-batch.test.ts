import { describe, it, expect } from 'vitest';

import {
  EncounterBatchSequencer,
  batchToTickResponse,
  type EncounterBatchRow,
} from '@/features/combat/utils/encounter-batch';
import { BATCH_ENVELOPE_VERSION } from '@/shared/combat/c3/decode-batch';

const CHAR = '22222222-2222-4222-8222-222222222222';
const CREATURE = '33333333-3333-4333-8333-333333333333';

function payload(tick: number, over: Record<string, unknown> = {}) {
  return {
    v: BATCH_ENVELOPE_VERSION,
    tick,
    batch_id: `b${tick}`,
    mode: 'live',
    ticks_processed: 1,
    events: [],
    characters: [],
    creatures: [],
    deaths: [],
    kills: [],
    rewards: [],
    progression: [],
    consumedBuffs: [],
    rejectedActions: [],
    consumedActionIds: [],
    effectUpserts: [],
    effectDeleteTargetIds: [],
    session: { ended: false, nextDueAtMs: 0 },
    ...over,
  };
}

const row = (tick: number, id = `b${tick}`, over: Record<string, unknown> = {}): EncounterBatchRow => ({
  batch_id: id,
  encounter_id: 'enc',
  tick_number: tick,
  payload: payload(tick, { batch_id: id, ...over }),
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

  it('buffers out-of-order arrivals and reports the hole', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    const out = s.ingest(row(4));
    expect(out.ready).toEqual([]);
    expect(out.missing).toEqual({ fromTick: 2, toTick: 3 });
    const recovered = s.ingest([row(2), row(3)]);
    expect(recovered.ready.map(r => r.tick_number)).toEqual([2, 3, 4]);
    expect(recovered.missing).toBeNull();
  });

  it('treats an acknowledgement as a hole, never as an applied tick', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(7));
    const out = s.noteCommitted(8, 'b8');
    expect(out.ready).toEqual([]);
    expect(out.missing).toEqual({ fromTick: 8, toTick: 8 });
    expect(s.appliedTick).toBe(7);
    // The committed batch itself is what advances the cursor.
    expect(s.ingest(row(8)).ready.map(r => r.tick_number)).toEqual([8]);
    expect(s.missingRange()).toBeNull();
  });

  it('anchors on the first thing it learns so mid-fight joins do not refetch history', () => {
    const s = new EncounterBatchSequencer();
    expect(s.noteCommitted(120, 'b120').missing).toEqual({ fromTick: 120, toTick: 120 });
    expect(s.ingest(row(120)).ready.map(r => r.tick_number)).toEqual([120]);
  });

  it('bounds one recovery window', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(1));
    const out = s.noteCommitted(500);
    expect(out.missing).toEqual({ fromTick: 2, toTick: 257 });
  });

  it('resets between encounters', () => {
    const s = new EncounterBatchSequencer();
    s.ingest(row(9));
    s.reset();
    expect(s.ingest(row(1)).ready.map(r => r.tick_number)).toEqual([1]);
  });
});

describe('batchToTickResponse', () => {
  it('rejects payloads that are not committed batches', () => {
    expect(batchToTickResponse({ ...row(1), payload: null })).toBeNull();
    expect(batchToTickResponse({ ...row(1), payload: { foo: 1 } })).toBeNull();
    expect(batchToTickResponse({ ...row(1), payload: payload(1, { v: 2 }) })).toBeNull();
  });

  it('carries batch identity and creature state', () => {
    const r = row(3, 'b3', {
      creatures: [
        { creatureId: CREATURE, spawnSeq: 1, hpBefore: 5, hpAfter: 0, killed: true, creatureName: 'Rat' },
      ],
    });
    const res = batchToTickResponse(r);
    expect(res?.encounter_tick).toBe(3);
    expect(res?.encounter_batch_id).toBe('b3');
    expect(res?.creature_states).toEqual([{ id: CREATURE, hp: 0, alive: false }]);
    expect(res?.alive_creature_ids).toEqual([]);
  });

  it('turns committed reward deltas into absolutes over the local baseline', () => {
    const r = row(4, 'b4', {
      characters: [
        { characterId: CHAR, hpBefore: 40, hpAfter: 38, cpBefore: 10, cpAfter: 8, absorbShieldAfter: 3, died: false },
      ],
      rewards: [{ characterId: CHAR, creatureId: CREATURE, xp: 25, gold: 7, renown: 2 }],
    });
    const res = batchToTickResponse(r, {
      [CHAR]: { xp: 100, gold: 50, level: 4, maxHp: 44, renown: 1, renownTotalEarned: 9 },
    });
    const me = res!.member_states[0];
    expect(me).toMatchObject({ character_id: CHAR, hp: 38, cp: 8, xp: 125, gold: 57, level: 4, max_hp: 44 });
    expect(me.bhp).toBe(3);
    expect(me.rp_total_earned).toBe(11);
    expect(res!.buff_sync?.[CHAR]).toEqual({ absorb_remaining: 3 });
  });

  it('lets a committed level-up override delta arithmetic', () => {
    const r = row(5, 'b5', {
      characters: [
        { characterId: CHAR, hpBefore: 10, hpAfter: 10, cpBefore: 5, cpAfter: 5, absorbShieldAfter: 0, died: false },
      ],
      rewards: [{ characterId: CHAR, creatureId: CREATURE, xp: 60, gold: 0, renown: 0 }],
      progression: [{
        characterId: CHAR, levelBefore: 4, levelAfter: 5, xpAfter: 10,
        maxHpAfter: 60, maxCpAfter: 30, maxMpAfter: 20,
        hpAfter: 60, cpAfter: 30, mpAfter: 20,
        attributeDeltas: {}, unspentStatPointsDelta: 2, respecPointsDelta: 1,
      }],
    });
    const me = batchToTickResponse(r, {
      [CHAR]: { xp: 100, gold: 0, level: 4, maxHp: 44 },
    })!.member_states[0];
    expect(me.level).toBe(5);
    expect(me.xp).toBe(10);
    expect(me.max_hp).toBe(60);
    expect(me.unspent_stat_points).toBe(2);
    expect(me.respec_points).toBe(1);
  });

  it('reports the end of a fight from the committed session section', () => {
    const r = row(6, 'b6', { session: { ended: true, nextDueAtMs: 0 } });
    expect(batchToTickResponse(r)?.session_ended).toBe(true);
  });
});
