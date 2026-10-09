import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCharacter, type Character } from './useCharacter';

const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = (hp: number, userId = 'user-a', nodeId = 'node'): Character => ({
  id: CHARACTER, user_id: userId, name: 'Tester', gender: 'male', race: 'human', class: 'warrior',
  level: 1, xp: 0, hp, max_hp: 20, gold: 0, str: 10, dex: 10, con: 10, int: 10, wis: 10,
  cha: 10, ac: 10, current_node_id: nodeId, unspent_stat_points: 0, cp: hp, max_cp: 20,
  mp: hp, max_mp: 20, respec_points: 0, bhp: 0, bhp_trained: {}, rp_total_earned: 0,
  lifecycle_version: 0, deleted_at: null, restore_until: null,
});

const mocks = vi.hoisted(() => ({
  rows: [] as Character[][],
  query: vi.fn(),
  rpc: vi.fn(),
  readCreated: vi.fn(),
  change: null as null | ((payload: any) => void),
  status: null as null | ((status: string) => void),
  remove: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ order: mocks.query,
    eq: () => ({ single: mocks.readCreated }) }) }) }),
  channel: () => {
    const channel = {
      on: vi.fn((_type, _filter, callback) => { mocks.change = callback; return channel; }),
      subscribe: vi.fn((callback) => { mocks.status = callback; return channel; }),
    };
    return channel;
  },
  removeChannel: mocks.remove,
  rpc: mocks.rpc,
} }));

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  sessionStorage.setItem('selectedCharacterId', CHARACTER);
  mocks.rows = [[base(5)], [base(9)], [base(13)]];
  mocks.query.mockReset().mockImplementation(async () => ({ data: mocks.rows.shift() ?? [base(13)], error: null }));
  mocks.change = null;
  mocks.status = null;
  mocks.remove.mockReset();
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mocks.readCreated.mockReset().mockResolvedValue({ data: base(20), error: null });
});

describe('C2 authoritative creation delivery', () => {
  const choices = { name: 'Tester', race: 'human', gender: 'male' as const };
  it('reads authoritative row, deduplicates replay and waits for explicit selection', async () => {
    sessionStorage.removeItem('selectedCharacterId'); mocks.rows = [[]];
    mocks.rpc.mockResolvedValue({ data: { kind: 'applied', characterId: CHARACTER }, error: null });
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { await result.current.createCharacter(choices); });
    expect(result.current.characters).toHaveLength(1);
    expect(result.current.characters[0].hp).toBe(20); expect(result.current.character).toBeNull();
    await act(async () => { await result.current.createCharacter(choices); });
    expect(result.current.characters).toHaveLength(1);
    act(() => result.current.selectCharacterAfterCreate(CHARACTER));
    expect(result.current.character?.hp).toBe(20); unmount();
  });
  it('read-after-write failure retains original request for retry without speculative row', async () => {
    sessionStorage.removeItem('selectedCharacterId'); mocks.rows = [[]];
    mocks.rpc.mockResolvedValue({ data: { kind: 'applied', characterId: CHARACTER }, error: null });
    mocks.readCreated.mockResolvedValueOnce({ data: null, error: new Error('read unavailable') });
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { await expect(result.current.createCharacter(choices)).rejects.toThrow('read unavailable'); });
    expect(result.current.characters).toEqual([]);
    await act(async () => { await result.current.createCharacter(choices); });
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]); unmount();
  });
  it('rejects delegated inputs and does not resurrect a newer observed tombstone', async () => {
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await expect(result.current.createCharacter({ ...choices, targetAccount: 'other' })).rejects.toThrow('signed-in account');
    expect(mocks.rpc).not.toHaveBeenCalled();
    act(() => mocks.change?.({ eventType: 'UPDATE', new: { ...base(5), lifecycle_version: 1, deleted_at: '2026-10-09' } }));
    mocks.rpc.mockResolvedValue({ data: { kind: 'applied', characterId: CHARACTER }, error: null });
    await act(async () => { await expect(result.current.createCharacter(choices)).rejects.toThrow('no longer available'); });
    expect(result.current.characters).toEqual([]); unmount();
  });
});

describe('P2-C lifecycle cutover client', () => {
  const deletion = { kind: 'soft_deleted', characterId: CHARACTER, version: 1,
    deletedAt: '2026-10-09T12:00:00Z', restoreUntil: '2026-11-08T12:00:00Z' };
  it('keeps the same request/version across lost-response retry without optimistic deletion', async () => {
    mocks.rows = [[base(5)], [base(5)], []];
    mocks.rpc.mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce({ data: deletion, error: null });
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { await expect(result.current.deleteCharacter(CHARACTER)).rejects.toThrow('Network interrupted'); });
    expect(result.current.characters).toHaveLength(1);
    await act(async () => { await result.current.deleteCharacter(CHARACTER); });
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc.mock.calls[0][0]).toBe('character_lifecycle_command');
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ _expected_version: 0, _operation: 'soft_delete', _reason: null });
    expect(result.current.character).toBeNull();
    unmount();
  });
  it('does not call legacy hard deletion when lifecycle metadata or execution is unavailable', async () => {
    mocks.rows = [[{ ...base(5), lifecycle_version: undefined }]];
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { await expect(result.current.deleteCharacter(CHARACTER)).rejects.toThrow('unavailable'); });
    expect(mocks.rpc).not.toHaveBeenCalled();expect(result.current.characters).toHaveLength(1);
    unmount();
  });
  it('drops a realtime tombstone and rejects an older in-flight selection read', async () => {
    let release!: (value: unknown) => void;
    mocks.query.mockReset().mockResolvedValueOnce({ data: [base(5)], error: null })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});act(() => result.current.refetchCharacters());
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { ...base(5), lifecycle_version: 1, deleted_at: deletion.deletedAt } }); });
    await act(async () => { release({ data: [base(5)], error: null }); });
    expect(result.current.characters).toEqual([]);expect(result.current.character).toBeNull();
    act(() => result.current.selectCharacter(CHARACTER));expect(result.current.character).toBeNull();
    unmount();
  });
  it('accepts a later restoration delivery without selecting or refilling the character', async () => {
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { ...base(5), lifecycle_version: 1, deleted_at: deletion.deletedAt } }); });
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { ...base(5), lifecycle_version: 2 } }); });
    expect(result.current.characters).toHaveLength(1);expect(result.current.characters[0].hp).toBe(5);
    expect(result.current.character).toBeNull();unmount();
  });
});
afterEach(() => vi.useRealTimers());

describe('authoritative character resource delivery', () => {
  it('preserves newer realtime resources when an older read finishes afterward', async () => {
    let release!: (value: unknown) => void;
    mocks.query.mockReset().mockResolvedValueOnce({ data: [base(5)], error: null })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    act(() => result.current.refetchCharacters());
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: base(17) }); });
    const newerReadStartedAt = result.current.resourceDelivery.readStartedAt;
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await act(async () => { release({ data: [base(9)], error: null }); });
    expect(result.current.character).toMatchObject({ hp: 17, cp: 17, mp: 17 });
    expect(result.current.resourceDelivery.readStartedAt).toBe(newerReadStartedAt);
    unmount();
  });

  it('does not use another character realtime update as selected-character resource delivery', async () => {
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    const delivered = result.current.resourceDelivery;
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { ...base(17), id: 'other-character' } }); });
    expect(result.current.resourceDelivery).toBe(delivered);
    unmount();
  });
  it('renders a server update while the document remains focused and idle', async () => {
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    expect(result.current.character?.hp).toBe(5);
    expect(result.current.resourceDelivery.source).toBe('initial');
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(result.current.character?.hp).toBe(9);
    expect(result.current.resourceDelivery).toMatchObject({ status: 'current', source: 'poll' });
    unmount();
  });

  it('keeps focus refresh as a recovery path rather than the primary path', async () => {
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    expect(result.current.character?.hp).toBe(9);
    expect(result.current.resourceDelivery.source).toBe('focus');
    unmount();
  });

  it('applies scoped realtime rows immediately without a focus event', async () => {
    const { result, unmount } = renderHook(() => useCharacter({ id: 'user-a' } as any));
    await act(async () => {});
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: base(17) }); });
    expect(result.current.character?.hp).toBe(17);
    expect(result.current.resourceDelivery.source).toBe('realtime');
    unmount();
  });

  it('discards a late response from another user session', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.query.mockReset()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ data: [base(11, 'user-b')], error: null });
    const { result, rerender, unmount } = renderHook(({ id }) => useCharacter({ id } as any), { initialProps: { id: 'user-a' } });
    rerender({ id: 'user-b' });
    await act(async () => {
      resolveFirst({ data: [base(19, 'user-a')], error: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.characters[0]?.user_id).toBe('user-b');
    expect(result.current.character?.hp).toBe(11);
    unmount();
  });

  it('does not let an older refresh overwrite a later acknowledged movement',async()=>{
    let resolveOld!:(value:unknown)=>void;
    mocks.query.mockReset()
      .mockResolvedValueOnce({data:[base(5,'user-a','A')],error:null})
      .mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}))
      .mockResolvedValueOnce({data:[base(5,'user-a','D')],error:null});
    const {result,unmount}=renderHook(()=>useCharacter({id:'user-a'} as any));
    await act(async()=>{});
    act(()=>result.current.updateCharacterLocal({current_node_id:'B'}));
    act(()=>result.current.refetchCharacters());
    act(()=>result.current.updateCharacterLocal({current_node_id:'C'}));
    await act(async()=>{resolveOld({data:[base(5,'user-a','B')],error:null});await Promise.resolve();});
    expect(result.current.character?.current_node_id).toBe('C');
    await act(async()=>{result.current.refetchCharacters();await Promise.resolve();await Promise.resolve();});
    expect(result.current.character?.current_node_id).toBe('D');
    unmount();
  });
});
