import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCombat2StanceSession } from './useCombat2StanceSession';
import { selectCombat2Character } from './presentation-selectors';
import type { Character } from '@/features/character';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
const rpc = mocks.rpc;

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const projection = (characterId: string, keys: string[] = []) => ({ ok: true, kind: 'projected',
  character_id: characterId, raw_cp: 50, max_cp: 100, reserved_cp: keys.length * 10,
  spendable_cp: 50 - keys.length * 10, stances: keys.map(ability_key => ({
    ability_key, reserve_pct: 0.1, reserved_cp: 10, state: {}, version: 1,
  })) });

describe('useCombat2StanceSession', () => {
  beforeEach(() => rpc.mockReset());

  it('does not let a pre-activation read arriving late replace an acknowledged cost', async () => {
    rpc.mockResolvedValueOnce({ data: projection(A), error: null })
      .mockResolvedValueOnce({ data: { ok: true, kind: 'activated', projection: projection(A, ['force_shield']) }, error: null });
    const { result, rerender } = renderHook(({ revision, readStartedAt }) => useCombat2StanceSession({
      enabled: true, characterId: A, resourceRevision: revision, resourceReadStartedAt: readStartedAt,
    }), { initialProps: { revision: 1, readStartedAt: 100 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    const clock = vi.spyOn(Date, 'now').mockReturnValue(200);
    try {
      await act(async () => { await result.current.change('force_shield', 'activate'); });
      rerender({ revision: 2, readStartedAt: 150 });
      expect(result.current.acknowledgedResources?.cp).toBe(50);
      rerender({ revision: 3, readStartedAt: 250 });
      expect(result.current.acknowledgedResources).toBeNull();
    } finally { clock.mockRestore(); }
  });

  it('shows acknowledged OOC cost only until fresh delivery, retaining multiple stance reservations through activation and drop', async () => {
    rpc.mockResolvedValueOnce({ data: projection(A, ['force_shield']), error: null })
      .mockResolvedValueOnce({ data: { ok: true, kind: 'activated', projection: projection(A, ['force_shield', 'ignite']) }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, kind: 'dropped', projection: projection(A, ['force_shield']) }, error: null });
    const { result, rerender } = renderHook(({ revision, cp }) => {
      const stance = useCombat2StanceSession({ enabled: true, characterId: A, resourceRevision: revision, maxCp: 100 });
      return { ...stance, character: selectCombat2Character(true, null,
        { id: A, cp, max_cp: 100, hp: 80, mp: 30 } as Character, stance.acknowledgedResources) };
    }, { initialProps: { revision: 1, cp: 80 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    // Reading stance identity must never replace current character resources.
    expect(result.current.character.cp).toBe(80);
    await act(async () => { await result.current.change('ignite', 'activate'); });
    expect(result.current.character.cp).toBe(50);
    rerender({ revision: 2, cp: 65 });
    expect(result.current.character).toMatchObject({ cp: 65, hp: 80, mp: 30 });
    expect(result.current.projection?.reservedCp).toBe(20);
    expect(result.current.projection?.stances).toHaveLength(2);
    rerender({ revision: 3, cp: 90 });
    expect(result.current.character.cp).toBe(90);
    await act(async () => { await result.current.change('ignite', 'drop'); });
    rerender({ revision: 4, cp: 95 });
    expect(result.current.character.cp).toBe(95);
    expect(result.current.projection?.reservedCp).toBe(10);
    expect(rpc).toHaveBeenCalledTimes(3); // No refresh/RPC on every regeneration update.
  });

  it('refreshes server reservation projection on effective max CP change without client percentage calculation', async () => {
    rpc.mockResolvedValueOnce({ data: projection(A, ['force_shield']), error: null })
      .mockResolvedValueOnce({ data: { ...projection(A, ['force_shield']), max_cp: 200, reserved_cp: 23,
        stances: [{ ...projection(A, ['force_shield']).stances[0], reserved_cp: 23 }] }, error: null });
    const { result, rerender } = renderHook(({ maxCp }) => useCombat2StanceSession({ enabled: true, characterId: A, maxCp }),
      { initialProps: { maxCp: 100 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    rerender({ maxCp: 200 });
    await waitFor(() => expect(result.current.projection?.maxCp).toBe(200));
    expect(result.current.projection?.reservedCp).toBe(23);
    expect(result.current.projection?.stances[0].reservedCp).toBe(23);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('discards delayed cost acknowledgements after newer delivery and old reads after mutation', async () => {
    let releaseRead!: (value: unknown) => void;
    let releaseChange!: (value: unknown) => void;
    rpc.mockResolvedValueOnce({ data: projection(A), error: null })
      .mockImplementationOnce(() => new Promise(resolve => { releaseRead = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { releaseChange = resolve; }));
    const { result, rerender } = renderHook(({ revision }) => useCombat2StanceSession({ enabled: true, characterId: A, resourceRevision: revision }),
      { initialProps: { revision: 1 } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => { void result.current.refresh(); });
    let changing!: ReturnType<typeof result.current.change>;
    act(() => { changing = result.current.change('force_shield', 'activate'); });
    rerender({ revision: 2 });
    await act(async () => {
      releaseChange({ data: { ok: true, kind: 'activated', projection: projection(A, ['force_shield']) }, error: null });
      await changing;
      releaseRead({ data: projection(A), error: null });
    });
    expect(result.current.acknowledgedResources).toBeNull();
    expect(result.current.projection?.stances[0].abilityKey).toBe('force_shield');
  });

  it('clears OOC acknowledgements across combat entry/exit and fences late character/session changes', async () => {
    let release!: (value: unknown) => void;
    rpc.mockResolvedValue({ data: projection(A), error: null });
    const { result, rerender } = renderHook(({ characterId, session }) => useCombat2StanceSession({
      enabled: true, characterId, refreshKey: session, resourceRevision: 1,
    }), { initialProps: { characterId: A, session: 'idle' } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    rpc.mockResolvedValueOnce({ data: { ok: true, kind: 'activated', projection: projection(A, ['force_shield']) }, error: null });
    await act(async () => { await result.current.change('force_shield', 'activate'); });
    expect(result.current.acknowledgedResources?.cp).toBe(50);
    rerender({ characterId: A, session: 'active' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.acknowledgedResources).toBeNull();
    rerender({ characterId: A, session: 'exited' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.acknowledgedResources).toBeNull();
    rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let changing!: ReturnType<typeof result.current.change>;
    act(() => { changing = result.current.change('force_shield', 'activate'); });
    rpc.mockResolvedValue({ data: projection(B), error: null });
    rerender({ characterId: B, session: 'idle' });
    await waitFor(() => expect(result.current.projection?.characterId).toBe(B));
    await act(async () => {
      release({ data: { ok: true, kind: 'activated', projection: projection(A, ['force_shield']) }, error: null });
      expect(await changing).toMatchObject({ status: 'stale' });
    });
    expect(result.current.acknowledgedResources).toBeNull();
    expect(result.current.projection?.characterId).toBe(B);
  });

  it('hydrates outside combat and applies the authoritative mutation projection once', async () => {
    rpc.mockResolvedValueOnce({ data: projection(A), error: null })
      .mockResolvedValueOnce({ data: { ok: true, kind: 'activated', projection: projection(A, ['eagle_eye']) }, error: null });
    const { result } = renderHook(() => useCombat2StanceSession({ enabled: true, characterId: A,
      generateRequestId: () => '33333333-3333-4333-8333-333333333333' }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.change('eagle_eye', 'activate')).toMatchObject({ status: 'accepted' }); });
    expect(result.current.projection?.stances.map(stance => stance.abilityKey)).toEqual(['eagle_eye']);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('fences a late hydration response after character switching', async () => {
    let release!: (value: { data: unknown; error: null }) => void;
    rpc.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce({ data: projection(B), error: null });
    const { result, rerender } = renderHook(({ characterId }) => useCombat2StanceSession({ enabled: true, characterId }),
      { initialProps: { characterId: A } });
    rerender({ characterId: B });
    await waitFor(() => expect(result.current.projection?.characterId).toBe(B));
    release({ data: projection(A, ['force_shield']), error: null });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.projection?.characterId).toBe(B);
    expect(result.current.projection?.stances).toEqual([]);
  });

  it('reuses a request id only for an uncertain retry and uses a new id after a refusal', async () => {
    const ids = ['33333333-3333-4333-8333-333333333331', '33333333-3333-4333-8333-333333333332'];
    rpc.mockResolvedValueOnce({ data: projection(A), error: null })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { ok: false, kind: 'insufficient_cp' }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, kind: 'activated', projection: projection(A, ['eagle_eye']) }, error: null });
    const { result } = renderHook(() => useCombat2StanceSession({ enabled: true, characterId: A,
      generateRequestId: () => ids.shift()! }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { expect(await result.current.change('eagle_eye', 'activate')).toMatchObject({ status: 'uncertain' }); });
    await act(async () => { expect(await result.current.change('eagle_eye', 'activate')).toMatchObject({ status: 'refused' }); });
    await act(async () => { expect(await result.current.change('eagle_eye', 'activate')).toMatchObject({ status: 'accepted' }); });
    const requestIds = rpc.mock.calls.slice(1).map(call => call[1]._request_id);
    expect(requestIds).toEqual([requestIds[0], requestIds[0], '33333333-3333-4333-8333-333333333332']);
  });
});
