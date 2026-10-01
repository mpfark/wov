import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCombat2StanceSession } from './useCombat2StanceSession';

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
