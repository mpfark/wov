import { describe, expect, it, vi } from 'vitest';
import { Combat2EntryError, createCombat2EntryAdapter, decodeCombat2Entry } from './entry';

const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const FIGHTER = 'cccccccc-0000-4000-8000-000000000001';
const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const REQUEST = 'dddddddd-0000-4000-8000-000000000001';

describe('decodeCombat2Entry', () => {
  it.each([
    ['entered', true, false, 'entered'],
    ['reentered', true, false, 'reentered'],
    ['already_entered', true, false, 'already_entered'],
    ['already_present', false, false, 'already_present'],
    ['entered', true, true, 'reactivated'],
  ] as const)('accepts installed %s identity contract', (kind, ok, reactivated, classification) => {
    expect(decodeCombat2Entry({ ok, kind, reactivated, encounter_id: ENCOUNTER, fighter_id: FIGHTER, entry_seq: 7 })).toEqual({
      status: 'entered', classification, encounterId: ENCOUNTER, fighterId: FIGHTER, entrySeq: 7,
    });
  });

  it.each([
    [{ ok: false, kind: 'mode_refused', reason: 'maintenance' }, 'maintenance'],
    [{ ok: false, kind: 'no_living_creatures' }, 'no_living_creatures'],
    [{ ok: false, kind: 'not_authorized', reason: 'character' }, 'not_authorized'],
    [{ ok: false, kind: 'no_node' }, 'no_node'],
    [{ ok: false, kind: 'node_changed' }, 'node_changed'],
    [{ ok: false, kind: 'invalid_request', reason: 'request_id_conflict' }, 'invalid_request'],
    [{ ok: false, kind: 'future_refusal' }, 'refused'],
  ] as const)('normalizes refusal %#', (payload, classification) => {
    expect(decodeCombat2Entry(payload)).toMatchObject({ status: 'refused', classification });
  });

  it.each([
    null,
    { ok: true, kind: 'entered', encounter_id: 'legacy-id' },
    { ok: true, kind: 'unknown_success', encounter_id: ENCOUNTER },
    { ok: true, kind: 'entered', encounter_id: ENCOUNTER, fighter_id: 'bad' },
    { ok: true, kind: 'entered', encounter_id: ENCOUNTER, entry_seq: 1.5 },
  ])('rejects malformed or unknown success identity', (payload) => {
    expect(() => decodeCombat2Entry(payload)).toThrow(Combat2EntryError);
  });
});

describe('Combat2 entry transport', () => {
  it('calls only combat_enter and decodes structured success', async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true, kind: 'entered', encounter_id: ENCOUNTER }, error: null }));
    const adapter = createCombat2EntryAdapter({ rpc });
    await expect(adapter.enter(CHARACTER, REQUEST)).resolves.toMatchObject({ status: 'entered', encounterId: ENCOUNTER });
    expect(rpc).toHaveBeenCalledWith('combat_enter', { _character_id: CHARACTER, _request_id: REQUEST });
  });

  it.each([
    vi.fn(async () => { throw new Error('connection lost'); }),
    vi.fn(async () => ({ data: null, error: { message: 'response lost' } })),
  ])('classifies ambiguous transport as uncertain without retrying', async (rpc) => {
    const adapter = createCombat2EntryAdapter({ rpc });
    await expect(adapter.enter(CHARACTER, REQUEST)).rejects.toMatchObject({ code: 'uncertain' });
    expect(rpc).toHaveBeenCalledOnce();
  });
});
