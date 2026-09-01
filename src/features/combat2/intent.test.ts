import { describe, expect, it, vi } from 'vitest';
import { Combat2IntentError, createCombat2IntentAdapter, decodeCombat2Intent } from './intent';

const ENCOUNTER = '11111111-1111-4111-8111-111111111111';
const CHARACTER = '22222222-2222-4222-8222-222222222222';
const CREATURE = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const INTENT = '55555555-5555-4555-8555-555555555555';

describe('Combat2 intent adapter', () => {
  it('submits the exact ability RPC shape and decodes structured acceptance', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, kind: 'queued', intent_id: INTENT, seq: 7 }, error: null });
    const adapter = createCombat2IntentAdapter({ rpc });
    await expect(adapter.submit(ENCOUNTER, CHARACTER, {
      kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: CREATURE,
    }, REQUEST)).resolves.toMatchObject({ status: 'accepted', classification: 'queued', seq: 7 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('combat_intent', {
      _encounter_id: ENCOUNTER,
      _character_id: CHARACTER,
      _intent_kind: 'ability',
      _ability_key: 'fireball',
      _stance_key: null,
      _target_creature_id: CREATURE,
      _request_id: REQUEST,
    });
  });

  it.each(['stance_activate', 'stance_drop'] as const)('submits %s with stance-only shape', async (kind) => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, kind: 'already_queued', intent_id: INTENT, seq: 8, status: 'pending' }, error: null });
    const adapter = createCombat2IntentAdapter({ rpc });
    await adapter.submit(ENCOUNTER, CHARACTER, { kind, abilityKey: null, stanceKey: 'force_shield', targetCreatureId: CREATURE }, REQUEST);
    expect(rpc).toHaveBeenCalledWith('combat_intent', expect.objectContaining({
      _intent_kind: kind, _ability_key: null, _stance_key: 'force_shield', _target_creature_id: null,
    }));
  });

  it('preserves installed refusal classifications instead of trusting transport success', () => {
    expect(decodeCombat2Intent({ ok: false, kind: 'mode_refused', reason: 'maintenance' }))
      .toEqual({ status: 'refused', classification: 'maintenance', reason: 'maintenance' });
    expect(decodeCombat2Intent({ ok: false, kind: 'invalid_target', reason: 'not_in_encounter_or_dead' }))
      .toEqual({ status: 'refused', classification: 'invalid_target', reason: 'not_in_encounter_or_dead' });
  });

  it('rejects malformed and unknown-success payloads', () => {
    expect(() => decodeCombat2Intent({ ok: true, kind: 'queued' })).toThrow(Combat2IntentError);
    expect(() => decodeCombat2Intent({ ok: true, kind: 'surprise' })).toThrow(Combat2IntentError);
  });

  it('classifies RPC errors as uncertain for same-request retry', async () => {
    const adapter = createCombat2IntentAdapter({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } }) });
    await expect(adapter.submit(ENCOUNTER, CHARACTER, {
      kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: CREATURE,
    }, REQUEST)).rejects.toMatchObject({ code: 'uncertain' });
  });
});
