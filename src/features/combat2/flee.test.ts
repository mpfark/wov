import { describe, expect, it, vi } from 'vitest';
import { Combat2FleeError, createCombat2FleeAdapter, decodeCombat2Flee } from './flee';

const ENCOUNTER = '11111111-1111-4111-8111-111111111111';
const CHARACTER = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const EVENT = '44444444-4444-4444-8444-444444444444';
const FIGHTER = '55555555-5555-4555-8555-555555555555';

describe('Combat2 flee adapter', () => {
  it('keeps a queued authoritative exit open and reports death without pretending escape succeeded', () => {
    expect(decodeCombat2Flee({ ok: true, kind: 'queued', event_id: EVENT, fighter_id: FIGHTER, state_version: 10 }))
      .toMatchObject({ status: 'queued', classification: 'queued', eventId: EVENT });
    expect(decodeCombat2Flee({ ok: true, kind: 'dead', event_id: EVENT, fighter_id: FIGHTER }))
      .toMatchObject({ status: 'dead', classification: 'dead', eventId: EVENT });
  });
  it('calls the exact RPC and decodes fled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, kind: 'fled', event_id: EVENT, fighter_id: FIGHTER, state_version: 9 }, error: null });
    const adapter = createCombat2FleeAdapter({ rpc });
    await expect(adapter.flee(ENCOUNTER, CHARACTER, REQUEST)).resolves.toEqual({
      status: 'fled', classification: 'fled', eventId: EVENT, fighterId: FIGHTER, stateVersion: 9,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('combat_flee', {
      _encounter_id: ENCOUNTER, _character_id: CHARACTER, _request_id: REQUEST,
    });
  });

  it('treats already_fled as authoritative idempotent success', () => {
    expect(decodeCombat2Flee({ ok: true, kind: 'already_fled', event_id: EVENT })).toEqual({
      status: 'fled', classification: 'already_fled', eventId: EVENT, fighterId: null, stateVersion: null,
    });
  });

  it.each([
    [{ ok: false, kind: 'not_present' }, 'not_present'],
    [{ ok: false, kind: 'not_authorized', reason: 'character' }, 'not_authorized'],
    [{ ok: false, kind: 'invalid_request', reason: 'request_id_conflict' }, 'invalid_request'],
    [{ ok: false, kind: 'no_encounter' }, 'no_encounter'],
    [{ ok: false, kind: 'mode_refused', reason: 'maintenance' }, 'maintenance'],
  ] as const)('classifies refusal %#', (payload, classification) => {
    expect(decodeCombat2Flee(payload)).toMatchObject({ status: 'refused', classification });
  });

  it('rejects malformed or unknown-success responses', () => {
    expect(() => decodeCombat2Flee({ ok: true, kind: 'fled' })).toThrow(Combat2FleeError);
    expect(() => decodeCombat2Flee({ ok: true, kind: 'other', event_id: EVENT })).toThrow(Combat2FleeError);
  });

  it('classifies transport failure as uncertain', async () => {
    const adapter = createCombat2FleeAdapter({ rpc: vi.fn().mockRejectedValue(new Error('offline')) });
    await expect(adapter.flee(ENCOUNTER, CHARACTER, REQUEST)).rejects.toMatchObject({ code: 'uncertain' });
  });
});
