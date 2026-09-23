import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCharacter, type Character } from './useCharacter';

const CHARACTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = (hp: number, userId = 'user-a'): Character => ({
  id: CHARACTER, user_id: userId, name: 'Tester', gender: 'male', race: 'human', class: 'warrior',
  level: 1, xp: 0, hp, max_hp: 20, gold: 0, str: 10, dex: 10, con: 10, int: 10, wis: 10,
  cha: 10, ac: 10, current_node_id: 'node', unspent_stat_points: 0, cp: hp, max_cp: 20,
  mp: hp, max_mp: 20, respec_points: 0, bhp: 0, bhp_trained: {}, rp_total_earned: 0,
});

const mocks = vi.hoisted(() => ({
  rows: [] as Character[][],
  query: vi.fn(),
  change: null as null | ((payload: any) => void),
  status: null as null | ((status: string) => void),
  remove: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ order: mocks.query }) }) }),
  channel: () => {
    const channel = {
      on: vi.fn((_type, _filter, callback) => { mocks.change = callback; return channel; }),
      subscribe: vi.fn((callback) => { mocks.status = callback; return channel; }),
    };
    return channel;
  },
  removeChannel: mocks.remove,
  rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
});
afterEach(() => vi.useRealTimers());

describe('authoritative character resource delivery', () => {
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
});
