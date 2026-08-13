/**
 * C3 checkpoint-1 regression tests for the committed-batch decoder and the
 * root strictness gap the seeded database round trip exposed.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeTickBatch,
  projectBatchFromProposal,
  BATCH_ENVELOPE_VERSION,
} from '@/shared/combat/c3/decode-batch';
import { decodeEncounterSnapshot } from '@/shared/combat/c3/decode-snapshot';
import type { ProposedTick } from '@/shared/combat/pure/types';

function batchPayload(over: Record<string, unknown> = {}) {
  return {
    v: BATCH_ENVELOPE_VERSION,
    tick: 7,
    batch_id: '11111111-1111-4111-8111-111111111111',
    mode: 'live',
    events: [
      {
        seq: 0,
        type: 'hit',
        message: 'Hero hits Rat for 4.',
        characterId: '22222222-2222-4222-8222-222222222222',
        creatureId: '33333333-3333-4333-8333-333333333333',
        amount: 4,
        damageType: 'physical',
      },
    ],
    characters: [
      {
        characterId: '22222222-2222-4222-8222-222222222222',
        hpBefore: 40,
        hpAfter: 38,
        cpBefore: 10,
        cpAfter: 10,
        absorbShieldAfter: 0,
        died: false,
      },
    ],
    creatures: [
      {
        creatureId: '33333333-3333-4333-8333-333333333333',
        spawnSeq: 2,
        hpBefore: 4,
        hpAfter: 0,
        killed: true,
        creatureName: 'Rat',
      },
    ],
    deaths: [],
    kills: [],
    ...over,
  };
}

describe('c3 batch decoder', () => {
  it('decodes a committed batch payload', () => {
    const b = decodeTickBatch(batchPayload());
    expect(b.tick).toBe(7);
    expect(b.envelopeVersion).toBe(BATCH_ENVELOPE_VERSION);
    expect(b.events[0].message).toContain('Hero hits Rat');
    expect(b.creatures[0].killed).toBe(true);
  });

  it('refuses an unknown top-level field', () => {
    expect(() => decodeTickBatch(batchPayload({ surprise: 1 }))).toThrow(/decode_failed.*unknown field/s);
  });

  it('refuses an unknown nested field', () => {
    const p = batchPayload();
    (p.events[0] as Record<string, unknown>).extra = true;
    expect(() => decodeTickBatch(p)).toThrow(/decode_failed/);
  });

  it('refuses a mismatched envelope version', () => {
    expect(() => decodeTickBatch(batchPayload({ v: 3 }))).toThrow(/unsupported batch envelope version/);
    expect(() => decodeTickBatch(batchPayload({ v: 1 }))).toThrow(/unsupported batch envelope version/);
  });

  it('refuses a missing required field', () => {
    const p = batchPayload() as Record<string, unknown>;
    delete (p.characters as Record<string, unknown>[])[0].hpBefore;
    expect(() => decodeTickBatch(p)).toThrow(/decode_failed.*hpBefore/s);
  });

  it('projects a ProposedTick into the exact delivery shape', () => {
    const proposed = {
      tickNumber: 7,
      mode: 'live',
      characters: [
        {
          characterId: '22222222-2222-4222-8222-222222222222',
          hpBefore: 40,
          hpAfter: 38,
          cpBefore: 10,
          cpAfter: 10,
          absorbShieldAfter: 0,
          died: false,
        },
      ],
      creatures: [
        {
          creatureId: '33333333-3333-4333-8333-333333333333',
          hpBefore: 4,
          hpAfter: 0,
          killed: true,
          lastSourceCharacterId: null,
          lastSourceKind: null,
        },
      ],
      kills: [{ creatureId: '33333333-3333-4333-8333-333333333333', creatureName: 'Rat' }],
      events: [
        {
          seq: 0,
          type: 'hit',
          message: 'Hero hits Rat for 4.',
          characterId: '22222222-2222-4222-8222-222222222222',
          creatureId: '33333333-3333-4333-8333-333333333333',
          amount: 4,
          damageType: 'physical',
        },
      ],
    } as unknown as ProposedTick;

    const projected = projectBatchFromProposal(
      proposed,
      '11111111-1111-4111-8111-111111111111',
      { '33333333-3333-4333-8333-333333333333': 2 },
    );
    const decoded = decodeTickBatch(batchPayload());
    expect(JSON.stringify({ ...decoded, deaths: [], kills: [] })).toBe(JSON.stringify(projected));
  });
});

describe('c3 snapshot root strictness', () => {
  it('refuses an unknown top-level snapshot section', () => {
    // Root strictness gap found by the seeded round trip: an added top-level
    // section used to pass straight through the decoder.
    expect(() => decodeEncounterSnapshot({ loaded: true, snapshotVersion: 3, surprise: 1 }, {} as never)).toThrow(
      /decode_failed.*unknown field\(s\): surprise/s,
    );
  });
});
