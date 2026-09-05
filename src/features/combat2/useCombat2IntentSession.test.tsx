import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combat2IntentError, type Combat2IntentAction, type Combat2IntentAdapter, type Combat2IntentOutcome } from './intent';
import { useCombat2IntentSession } from './useCombat2IntentSession';

const CHARACTER = '22222222-2222-4222-8222-222222222222';
const NODE = '11111111-1111-4111-8111-111111111111';
const NODE_2 = '11111111-1111-4111-8111-111111111112';
const ENCOUNTER = '33333333-3333-4333-8333-333333333333';
const REQUEST_1 = '44444444-4444-4444-8444-444444444441';
const REQUEST_2 = '44444444-4444-4444-8444-444444444442';
const action: Combat2IntentAction = { kind: 'ability', abilityKey: 'fireball', stanceKey: null, targetCreatureId: null };
const accepted = { status: 'accepted' as const, classification: 'queued' as const, intentId: ENCOUNTER, seq: 1, intentStatus: null };

describe('useCombat2IntentSession', () => {
  it('one deliberate action submits once; rerenders and Strict Mode do not duplicate it', async () => {
    const adapter: Combat2IntentAdapter = { submit: vi.fn().mockResolvedValue(accepted) };
    const generateRequestId = vi.fn(() => REQUEST_1);
    const { result, rerender } = renderHook(() => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER, adapter, generateRequestId,
    }), { wrapper: StrictMode });
    rerender();
    await act(async () => { await result.current.submit(action); });
    rerender();
    expect(adapter.submit).toHaveBeenCalledExactlyOnceWith(ENCOUNTER, CHARACTER, action, REQUEST_1);
    expect(generateRequestId).toHaveBeenCalledOnce();
  });

  it('an uncertain retry reuses the request id while a distinct action gets a new id', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(new Combat2IntentError('uncertain', 'timeout'))
      .mockResolvedValue(accepted);
    const adapter: Combat2IntentAdapter = { submit };
    const ids = [REQUEST_1, REQUEST_2];
    const { result } = renderHook(() => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER,
      adapter, generateRequestId: () => ids.shift()!,
    }));

    await act(async () => { expect(await result.current.submit(action)).toMatchObject({ status: 'uncertain' }); });
    await act(async () => { expect(await result.current.retry()).toMatchObject({ status: 'accepted' }); });
    await act(async () => { await result.current.submit({ ...action, abilityKey: 'frost_bolt' }); });
    expect(submit.mock.calls.map((call) => call[3])).toEqual([REQUEST_1, REQUEST_1, REQUEST_2]);
  });

  it('an explicit retry of a structured refusal also reuses the action request id', async () => {
    const refused = { status: 'refused' as const, classification: 'invalid_target' as const, reason: 'dead' };
    const adapter: Combat2IntentAdapter = { submit: vi.fn().mockResolvedValue(refused) };
    const { result } = renderHook(() => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER,
      adapter, generateRequestId: () => REQUEST_1,
    }));
    await act(async () => { await result.current.submit(action); });
    await act(async () => { await result.current.retry(); });
    expect(adapter.submit).toHaveBeenCalledTimes(2);
    expect((adapter.submit as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[3])).toEqual([REQUEST_1, REQUEST_1]);
  });

  it('refuses locally without an authoritative session', async () => {
    const adapter: Combat2IntentAdapter = { submit: vi.fn() };
    const { result } = renderHook(() => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: null, adapter,
    }));
    await expect(result.current.submit(action)).resolves.toMatchObject({ status: 'local_refusal', classification: 'no_session' });
    expect(adapter.submit).not.toHaveBeenCalled();
  });

  it('discards a late response after node or session invalidation', async () => {
    let release!: (value: typeof accepted) => void;
    const adapter: Combat2IntentAdapter = { submit: vi.fn(() => new Promise<Combat2IntentOutcome>((resolve) => { release = resolve; })) };
    const { result, rerender } = renderHook(({ nodeId, encounterId }) => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId, encounterId, adapter, generateRequestId: () => REQUEST_1,
    }), { initialProps: { nodeId: NODE, encounterId: ENCOUNTER as string | null } });

    let pending!: ReturnType<typeof result.current.submit>;
    act(() => { pending = result.current.submit(action); });
    rerender({ nodeId: NODE_2, encounterId: null });
    release(accepted);
    await expect(pending).resolves.toEqual({ status: 'stale' });
  });

  it('suppresses an identical in-flight control and publishes acknowledgement only after acceptance', async () => {
    let release!: (value: typeof accepted) => void;
    const adapter: Combat2IntentAdapter = { submit: vi.fn(() => new Promise<Combat2IntentOutcome>((resolve) => { release = resolve; })) };
    const { result } = renderHook(() => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER,
      authoritativeTick: 10, adapter, generateRequestId: () => REQUEST_1,
    }));
    let first!: ReturnType<typeof result.current.submit>;
    act(() => { first = result.current.submit(action, { message: 'You prepare Fireball.' }); });
    expect(result.current.pending).toBeNull();
    await expect(result.current.submit(action, { message: 'You prepare Fireball.' }))
      .resolves.toMatchObject({ classification: 'in_flight' });
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    await act(async () => { release(accepted); await first; });
    expect(result.current.pending?.message).toBe('You prepare Fireball.');
  });

  it('clears pending acknowledgement on tick advance and delivery failure', async () => {
    const adapter: Combat2IntentAdapter = { submit: vi.fn().mockResolvedValue(accepted) };
    const { result, rerender } = renderHook(({ tick, status }) => useCombat2IntentSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER,
      authoritativeTick: tick, deliveryStatus: status, adapter, generateRequestId: () => REQUEST_1,
    }), { initialProps: { tick: 10, status: 'live' } });
    await act(async () => { await result.current.submit(action, { message: 'You prepare Fireball.' }); });
    expect(result.current.pending).not.toBeNull();
    rerender({ tick: 11, status: 'live' });
    expect(result.current.pending).toBeNull();
    await act(async () => { await result.current.submit(action, { message: 'You prepare Fireball.' }); });
    rerender({ tick: 11, status: 'gap' });
    expect(result.current.pending).toBeNull();
  });
});
