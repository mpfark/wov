import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combat2FleeError, type Combat2FleeAdapter, type Combat2FleeOutcome } from './flee';
import { useCombat2FleeSession } from './useCombat2FleeSession';

const CHARACTER = '22222222-2222-4222-8222-222222222222';
const CHARACTER_2 = '22222222-2222-4222-8222-222222222223';
const NODE = '11111111-1111-4111-8111-111111111111';
const NODE_2 = '11111111-1111-4111-8111-111111111112';
const ENCOUNTER = '33333333-3333-4333-8333-333333333333';
const ENCOUNTER_2 = '33333333-3333-4333-8333-333333333334';
const EVENT = '55555555-5555-4555-8555-555555555555';
const REQUEST_1 = '44444444-4444-4444-8444-444444444441';
const REQUEST_2 = '44444444-4444-4444-8444-444444444442';
const fled = { status: 'fled' as const, classification: 'fled' as const, eventId: EVENT, fighterId: null, stateVersion: 2 };

describe('useCombat2FleeSession', () => {
  it('one deliberate flee calls once; rerenders and Strict Mode do not duplicate it', async () => {
    const adapter: Combat2FleeAdapter = { flee: vi.fn().mockResolvedValue(fled) };
    const onExited = vi.fn();
    const { result, rerender } = renderHook(() => useCombat2FleeSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER,
      adapter, generateRequestId: () => REQUEST_1, onExited,
    }), { wrapper: StrictMode });
    rerender();
    await act(async () => { await result.current.flee(); });
    rerender();
    expect(adapter.flee).toHaveBeenCalledExactlyOnceWith(ENCOUNTER, CHARACTER, REQUEST_1);
    expect(onExited).toHaveBeenCalledExactlyOnceWith(`${CHARACTER}:${NODE}:${ENCOUNTER}`);
  });

  it('retry reuses the request id and a distinct later attempt gets a new id', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Combat2FleeError('uncertain', 'timeout')).mockResolvedValue(fled);
    const adapter: Combat2FleeAdapter = { flee: submit };
    const ids = [REQUEST_1, REQUEST_2];
    const { result } = renderHook(() => useCombat2FleeSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER,
      adapter, generateRequestId: () => ids.shift()!, onExited: vi.fn(),
    }));
    await act(async () => { expect(await result.current.flee()).toMatchObject({ status: 'uncertain' }); });
    await act(async () => { await result.current.retry(); });
    await act(async () => { await result.current.flee(); });
    expect(submit.mock.calls.map((call) => call[2])).toEqual([REQUEST_1, REQUEST_1, REQUEST_2]);
  });

  it('refuses locally without a valid session', async () => {
    const adapter: Combat2FleeAdapter = { flee: vi.fn() };
    const { result } = renderHook(() => useCombat2FleeSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: null, adapter, onExited: vi.fn(),
    }));
    await expect(result.current.flee()).resolves.toMatchObject({ status: 'local_refusal', classification: 'no_session' });
    expect(adapter.flee).not.toHaveBeenCalled();
  });

  it.each([
    { characterId: CHARACTER_2, nodeId: NODE, encounterId: ENCOUNTER },
    { characterId: CHARACTER, nodeId: NODE_2, encounterId: ENCOUNTER },
    { characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER_2 },
  ])('discards late success after session identity changes: %#', async (next) => {
    let release!: (value: typeof fled) => void;
    const adapter: Combat2FleeAdapter = { flee: vi.fn(() => new Promise<Combat2FleeOutcome>((resolve) => { release = resolve; })) };
    const onExited = vi.fn();
    const { result, rerender } = renderHook((props) => useCombat2FleeSession({
      enabled: true, ...props, adapter, generateRequestId: () => REQUEST_1, onExited,
    }), { initialProps: { characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER } });
    let pending!: ReturnType<typeof result.current.flee>;
    act(() => { pending = result.current.flee(); });
    rerender(next);
    release(fled);
    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(onExited).not.toHaveBeenCalled();
  });

  it.each([
    { value: { status: 'refused' as const, classification: 'not_present' as const, reason: null } },
    { value: new Combat2FleeError('error', 'malformed'), rejects: true },
    { value: new Combat2FleeError('uncertain', 'offline'), rejects: true },
  ])('does not exit for refusal/error %#', async ({ value, rejects }) => {
    const adapter: Combat2FleeAdapter = { flee: rejects ? vi.fn().mockRejectedValue(value) : vi.fn().mockResolvedValue(value) };
    const onExited = vi.fn();
    const { result } = renderHook(() => useCombat2FleeSession({
      enabled: true, characterId: CHARACTER, nodeId: NODE, encounterId: ENCOUNTER, adapter, onExited,
    }));
    await act(async () => { await result.current.flee(); });
    expect(onExited).not.toHaveBeenCalled();
  });
});
