import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePartyBroadcast } from '@/features/party/hooks/usePartyBroadcast';
import { useCreatureBroadcast } from '@/features/combat/hooks/useCreatureBroadcast';
import { useBossCasts } from '@/features/combat/hooks/useBossCasts';
import { combat2BrowserBlocksLegacy, selectCombat2PartyMembers, selectCombat2Ward } from './browser-presentation';
import type { Combat2PresentationModel } from './presentation';
import type { Combat2StanceProjection } from './useCombat2StanceSession';
import type { PartyMember } from '@/features/party/hooks/useParty';

const mocks = vi.hoisted(() => ({ channel: vi.fn(), from: vi.fn(), removeChannel: vi.fn(), send: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: mocks }));
const members = ['a', 'b'].map(id => ({ character_id: id, status: 'accepted', character: {
  id, name: id, hp: 80, max_hp: 100, current_node_id: 'node',
} })) as PartyMember[];
const projection: Combat2StanceProjection = { characterId: 'a', rawCp: 80, maxCp: 100,
  reservedCp: 10, spendableCp: 70, stances: [{ abilityKey: 'force_shield', reservePct: 10,
    reservedCp: 10, version: 1, state: { ward_remaining: 3 } }] };
const model = { character: { id: 'a' }, allies: [{ characterId: 'b', hp: 27, maxHp: 101, present: true }],
  characterEffects: [{ abilityKey: 'force_shield', kind: 'absorb', targetCharacterId: 'a', magnitude: 2, isReservation: false }],
} as unknown as Combat2PresentationModel;

beforeEach(() => vi.clearAllMocks());

describe('Combat2 browser isolation', () => {
  it.each(['idle', 'entering', 'active', 'detached', 'loading', 'gap', 'refused', 'error'])(
    '%s does not mount legacy subscriptions/telegraph reads or timers', () => {
      vi.useFakeTimers();
      try {
        const handle = { onCreatureDamage: { current: null }, channelRef: { current: { send: mocks.send } } };
        const { result, unmount } = renderHook(() => {
          const blocked = combat2BrowserBlocksLegacy(true, false);
          return {
            party: usePartyBroadcast(blocked ? null : 'party', 'a'),
            creature: useCreatureBroadcast(handle as never, 'node', 'a', vi.fn(), undefined, !blocked),
            boss: useBossCasts(blocked ? null : 'node'),
          };
        });
        act(() => {
          result.current.party.broadcastHp('a', 1, 100, 'sync');
          result.current.creature.broadcastDamage('c', 1, 10, 'a', true);
          result.current.creature.markSoftDead('c');
        });
        expect(handle.onCreatureDamage.current).toBeNull();
        expect(mocks.channel).not.toHaveBeenCalled();
        expect(mocks.from).not.toHaveBeenCalled();
        expect(mocks.send).not.toHaveBeenCalled();
        expect(result.current.creature.softDeadIds.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        unmount();
      } finally { vi.useRealTimers(); }
    },
  );

  it('fences saved legacy party senders and late broadcasts across actor changes and suspension', () => {
    const listeners: Record<string, (payload: unknown) => void> = {};
    const channel = { on: vi.fn((_type, filter, callback) => { listeners[filter.event] = callback; return channel; }),
      subscribe: vi.fn(() => channel), send: mocks.send };
    mocks.channel.mockReturnValue(channel);
    const { result, rerender, unmount } = renderHook(({ party, actor }) => usePartyBroadcast(party, actor), {
      initialProps: { party: 'party' as string | null, actor: 'a' },
    });
    const old = result.current;
    const lateHp = listeners.party_hp;
    rerender({ party: 'party', actor: 'b' });
    act(() => { lateHp({ payload: { character_id: 'c', hp: 1, max_hp: 100 } }); old.broadcastHp('a', 1, 100, 'sync'); });
    expect(result.current.hpOverrides).toEqual({});
    expect(mocks.send).not.toHaveBeenCalled();
    rerender({ party: 'party', actor: 'a' });
    act(() => { lateHp({ payload: { character_id: 'c', hp: 1, max_hp: 100 } }); old.broadcastHp('a', 1, 100, 'sync'); });
    expect(result.current.hpOverrides).toEqual({});
    expect(mocks.send).not.toHaveBeenCalled();
    rerender({ party: null, actor: 'b' });
    act(() => result.current.broadcastHp('b', 1, 100, 'sync'));
    expect(mocks.send).not.toHaveBeenCalled();
    unmount();
  });

  it('fences saved creature callbacks across suspension even when returning to the same node and actor', () => {
    const handle = { onCreatureDamage: { current: null }, channelRef: { current: { send: mocks.send } } };
    const { result, rerender, unmount } = renderHook(({ enabled }) =>
      useCreatureBroadcast(handle as never, 'node', 'a', vi.fn(), undefined, enabled), {
      initialProps: { enabled: true },
    });
    const old = result.current;
    rerender({ enabled: false });
    rerender({ enabled: true });
    act(() => { old.markSoftDead('c'); old.broadcastDamage('c', 1, 10, 'a', true); });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.softDeadIds.size).toBe(0);
    unmount();
  });

  it('keeps authoritative party membership/location outside combat; snapshots refine HP without moving followers', () => {
    expect(selectCombat2PartyMembers('a', members, null)).toBe(members);
    const selected = selectCombat2PartyMembers('a', members, model);
    expect(selected).toHaveLength(2);
    expect(selected[1].character).toMatchObject({ hp: 27, max_hp: 101, current_node_id: 'node' });
    expect(members[1].character.hp).toBe(80);
    expect(selectCombat2PartyMembers('new-actor', members, model)).toEqual([]);
    expect(selectCombat2PartyMembers('b', members, model)).toBe(members);
  });

  it('uses authoritative ward delivery through entry, completion/movement/reconnect and actor fencing', () => {
    expect(selectCombat2Ward('a', projection, null)).toBe(3);
    expect(selectCombat2Ward('a', projection, model)).toBe(2);
    expect(selectCombat2Ward('a', projection, { ...model, characterEffects: [] })).toBeNull();
    expect(selectCombat2Ward('a', projection, null)).toBe(3);
    expect(selectCombat2Ward('b', projection, model)).toBeNull();
    expect(selectCombat2Ward('a', null, null)).toBeNull();
    expect(selectCombat2Ward('a', { ...projection, stances: [] }, null)).toBeNull();
    expect(combat2BrowserBlocksLegacy(false, false)).toBe(false);
    expect(combat2BrowserBlocksLegacy(false, true)).toBe(true);
  });
});
