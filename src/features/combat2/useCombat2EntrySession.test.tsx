import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combat2EntryError, type Combat2EntryAdapter, type Combat2EntryOutcome } from './entry';
import { useCombat2EntrySession } from './useCombat2EntrySession';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHARACTER_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const NODE = 'eeeeeeee-0000-4000-8000-000000000001';
const NODE_2 = 'eeeeeeee-0000-4000-8000-000000000002';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const FIGHTER = 'cccccccc-0000-4000-8000-000000000001';

const entered = (classification: 'entered' | 'already_entered' | 'already_present' | 'reentered' | 'reactivated' = 'entered'): Combat2EntryOutcome => ({
  status: 'entered', classification, encounterId: ENCOUNTER, fighterId: null, entrySeq: null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('useCombat2EntrySession', () => {
  it.each([
    { enabled: false, characterId: CHARACTER, nodeId: NODE, living: true, status: 'disabled' },
    { enabled: true, characterId: null, nodeId: NODE, living: true, status: 'idle' },
    { enabled: true, characterId: CHARACTER, nodeId: null, living: true, status: 'idle' },
    { enabled: true, characterId: CHARACTER, nodeId: NODE, living: null, status: 'idle' },
    { enabled: true, characterId: CHARACTER, nodeId: NODE, living: false, status: 'idle' },
  ] as const)('does no entry work for $status prerequisites', ({ living, status, ...props }) => {
    const adapter: Combat2EntryAdapter = { enter: vi.fn() };
    const { result } = renderHook(() => useCombat2EntrySession({ ...props, hasLivingCreatures: living, adapter, generateRequestId: vi.fn() }));
    expect(result.current.status).toBe(status);
    expect(adapter.enter).not.toHaveBeenCalled();
  });

  it('creates one logical request despite rerenders and refuses concurrent retry', async () => {
    const pending = deferred<Combat2EntryOutcome>();
    const adapter: Combat2EntryAdapter = { enter: vi.fn(() => pending.promise) };
    const requestId = vi.fn(() => 'request-1');
    const { result, rerender } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER, nodeId: NODE, hasLivingCreatures: true, adapter, generateRequestId: requestId }));
    await waitFor(() => expect(result.current.status).toBe('entering'));
    rerender();
    act(() => result.current.retry());
    expect(adapter.enter).toHaveBeenCalledOnce();
    expect(requestId).toHaveBeenCalledOnce();
    await act(async () => pending.resolve(entered()));
    expect(result.current.encounterId).toBe(ENCOUNTER);
  });

  it('reuses the request id only for an explicit uncertain retry', async () => {
    const adapter: Combat2EntryAdapter = {
      enter: vi.fn()
        .mockRejectedValueOnce(new Combat2EntryError('uncertain', 'response lost'))
        .mockResolvedValueOnce(entered('already_entered')),
    };
    const requestId = vi.fn(() => 'stable-request');
    const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER, nodeId: NODE, hasLivingCreatures: true, adapter, generateRequestId: requestId }));
    await waitFor(() => expect(result.current.status).toBe('uncertain'));
    expect(adapter.enter).toHaveBeenCalledOnce();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('entered'));
    expect(adapter.enter).toHaveBeenNthCalledWith(1, CHARACTER, 'stable-request');
    expect(adapter.enter).toHaveBeenNthCalledWith(2, CHARACTER, 'stable-request');
    expect(requestId).toHaveBeenCalledOnce();
  });

  it.each(['entered', 'already_entered', 'already_present', 'reentered', 'reactivated'] as const)(
    'stores authoritative %s identity for delivery',
    async (classification) => {
      const adapter: Combat2EntryAdapter = { enter: vi.fn(async () => entered(classification)) };
      const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER, nodeId: NODE, hasLivingCreatures: true, adapter, generateRequestId: () => 'request' }));
      await waitFor(() => expect(result.current.status).toBe('entered'));
      expect(result.current).toMatchObject({ encounterId: ENCOUNTER, classification });
    },
  );

  it.each(['maintenance', 'no_living_creatures', 'not_authorized'] as const)(
    'settles %s refusal without a loop',
    async (classification) => {
      const adapter: Combat2EntryAdapter = { enter: vi.fn(async (): Promise<Combat2EntryOutcome> => ({ status: 'refused', classification, reason: classification })) };
      const { result, rerender } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER, nodeId: NODE, hasLivingCreatures: true, adapter, generateRequestId: () => 'request' }));
      await waitFor(() => expect(result.current.status).toBe('refused'));
      rerender();
      expect(adapter.enter).toHaveBeenCalledOnce();
    },
  );

  it('clears identity and ignores a late response on node or character change', async () => {
    const first = deferred<Combat2EntryOutcome>();
    const second = deferred<Combat2EntryOutcome>();
    const adapter: Combat2EntryAdapter = { enter: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    const requestId = vi.fn().mockReturnValueOnce('request-1').mockReturnValueOnce('request-2');
    const { result, rerender } = renderHook(({ characterId, nodeId }) => useCombat2EntrySession({ enabled: true, characterId, nodeId, hasLivingCreatures: true, adapter, generateRequestId: requestId }), { initialProps: { characterId: CHARACTER, nodeId: NODE } });
    await waitFor(() => expect(adapter.enter).toHaveBeenCalledOnce());
    rerender({ characterId: CHARACTER_2, nodeId: NODE_2 });
    await waitFor(() => expect(adapter.enter).toHaveBeenCalledTimes(2));
    expect(result.current.encounterId).toBeNull();
    await act(async () => first.resolve(entered()));
    expect(result.current.encounterId).toBeNull();
    expect(adapter.enter).toHaveBeenNthCalledWith(2, CHARACTER_2, 'request-2');
  });

  it('retains an entered identity when the living hint later becomes false', async () => {
    const adapter: Combat2EntryAdapter = { enter: vi.fn(async () => entered()) };
    const { result, rerender } = renderHook(({ living }) => useCombat2EntrySession({ enabled: true, characterId: CHARACTER, nodeId: NODE, hasLivingCreatures: living, adapter, generateRequestId: () => 'request' }), { initialProps: { living: true } });
    await waitFor(() => expect(result.current.status).toBe('entered'));
    rerender({ living: false });
    expect(result.current.encounterId).toBe(ENCOUNTER);
  });

  it('lets one deliberate hostile action establish the authoritative session on a peaceful node', async () => {
    const engage = vi.fn(async () => entered());
    const adapter: Combat2EntryAdapter = { enter: vi.fn(), engage };
    const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER,
      nodeId: NODE, hasLivingCreatures: false, adapter, generateRequestId: () => 'engage-request' }));
    await act(async () => { expect(await result.current.engage(FIGHTER)).toMatchObject({ status: 'entered' }); });
    expect(engage).toHaveBeenCalledWith(CHARACTER, FIGHTER, 'engage-request');
    expect(result.current).toMatchObject({ status: 'entered', encounterId: ENCOUNTER });
    expect(adapter.enter).not.toHaveBeenCalled();
  });

  it('reuses the deliberate engagement request after an uncertain transport result', async () => {
    const engage = vi.fn()
      .mockRejectedValueOnce(new Combat2EntryError('uncertain', 'response lost'))
      .mockResolvedValueOnce(entered('already_entered'));
    const requestId = vi.fn(() => 'stable-engage-request');
    const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER,
      nodeId: NODE, hasLivingCreatures: false, adapter: { enter: vi.fn(), engage }, generateRequestId: requestId }));
    await act(async () => { await expect(result.current.engage(FIGHTER)).rejects.toMatchObject({ code: 'uncertain' }); });
    await act(async () => { await expect(result.current.engage(FIGHTER)).resolves.toMatchObject({ status: 'entered' }); });
    expect(engage).toHaveBeenNthCalledWith(1, CHARACTER, FIGHTER, 'stable-engage-request');
    expect(engage).toHaveBeenNthCalledWith(2, CHARACTER, FIGHTER, 'stable-engage-request');
    expect(requestId).toHaveBeenCalledOnce();
  });

  it('does not let a late speculative entry refusal overwrite deliberate engagement', async () => {
    const automatic = deferred<Combat2EntryOutcome>();
    const adapter: Combat2EntryAdapter = { enter: vi.fn(() => automatic.promise), engage: vi.fn(async () => entered()) };
    const { result } = renderHook(() => useCombat2EntrySession({ enabled: true, characterId: CHARACTER,
      nodeId: NODE, hasLivingCreatures: true, adapter, generateRequestId: vi.fn()
        .mockReturnValueOnce('automatic-request').mockReturnValueOnce('engage-request') }));
    await waitFor(() => expect(result.current.status).toBe('entering'));
    await act(async () => { await result.current.engage(FIGHTER); });
    expect(result.current.status).toBe('entered');
    await act(async () => automatic.resolve({ status: 'refused', classification: 'no_engagement', reason: null }));
    expect(result.current.status).toBe('entered');
    expect(result.current.encounterId).toBe(ENCOUNTER);
  });

  it('clears on logout and ignores completion after unmount', async () => {
    const pending = deferred<Combat2EntryOutcome>();
    const adapter: Combat2EntryAdapter = { enter: vi.fn(() => pending.promise) };
    const { result, rerender, unmount } = renderHook(({ characterId }) => useCombat2EntrySession({ enabled: true, characterId, nodeId: NODE, hasLivingCreatures: true, adapter, generateRequestId: () => 'request' }), { initialProps: { characterId: CHARACTER as string | null } });
    await waitFor(() => expect(adapter.enter).toHaveBeenCalledOnce());
    rerender({ characterId: null });
    expect(result.current.status).toBe('idle');
    expect(result.current.encounterId).toBeNull();
    unmount();
    await act(async () => pending.resolve(entered()));
  });
});
