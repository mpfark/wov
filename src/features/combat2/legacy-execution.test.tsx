import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { useGameLoop, type UseGameLoopParams } from '@/features/combat/hooks/useGameLoop';
import { useCombatDriver, type UseCombatDriverParams } from '@/features/combat/hooks/useCombatDriver';
import { useCombatActions, type UseCombatActionsParams } from '@/features/combat/hooks/useCombatActions';
import { ExecutionFence } from './execution-fence';

vi.mock('@/lib/worker-timer', () => ({
  setWorkerTimeout: vi.fn((fn, delay) => window.setTimeout(fn, delay)),
  clearWorkerTimeout: vi.fn(id => window.clearTimeout(id)),
  clearWorkerInterval: vi.fn(id => window.clearTimeout(id)),
}));

const character = { id: 'test-character', name: 'Tester', class: 'Mage', hp: 10, max_hp: 100, cp: 10, max_cp: 100, mp: 10, max_mp: 100, level: 1, gold: 100, xp: 0, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, current_node_id: 'test-node' };
const network = vi.fn(() => Promise.reject(new Error('Network forbidden in focused tests')));
beforeEach(() => { network.mockClear(); vi.stubGlobal('fetch', network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('legacy execution fences', () => {
  it('expires old leases permanently', () => {
    const fence = new ExecutionFence();
    fence.setEnabled(true);
    const old = fence.capture();
    fence.setEnabled(false);
    fence.setEnabled(true);
    expect(old()).toBe(false);
    expect(fence.capture()()).toBe(true);
  });

  it('cleans regen/death timers without flushing resources; retains unrelated buff state', async () => {
    vi.useFakeTimers();
    const updateCharacter = vi.fn().mockResolvedValue(undefined);
    const params = { character: { ...character, hp: 0 }, updateCharacter, equipped: [], equipmentBonuses: {}, getNode: vi.fn(), addLogEvent: vi.fn(), creatures: [], party: null, partyMembers: [], startingNodeId: 'home' } as unknown as UseGameLoopParams;
    const { result, rerender, unmount } = renderHook(({ enabled }) => useGameLoop({ ...params, combatEnabled: enabled }), { initialProps: { enabled: true } });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => result.current.buffSetters.setFoodBuff({ flatRegen: 5, expiresAt: 9999999999999 }));
    rerender({ enabled: false });
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(updateCharacter).not.toHaveBeenCalled();
    expect(result.current.buffState.foodBuff.flatRegen).toBe(5);
    unmount();
  });

  it('preserves legacy resurrection when not owned', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useGameLoop({ character: { ...character, hp: 0 }, updateCharacter: write, equipped: [], equipmentBonuses: {}, getNode: vi.fn(), addLogEvent: vi.fn(), creatures: [], party: null, partyMembers: [], startingNodeId: 'home' } as unknown as UseGameLoopParams));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(write).toHaveBeenCalledWith({ hp: 1, gold: 90, current_node_id: 'home' });
    unmount();
  });

  it('preserves a pending legacy regeneration flush on ordinary unmount', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const local = vi.fn();
    const { unmount } = renderHook(() => useGameLoop({ character, updateCharacter: write, updateCharacterLocal: local, equipped: [], equipmentBonuses: {}, getNode: vi.fn(), addLogEvent: vi.fn(), creatures: [], party: null, partyMembers: [] } as unknown as UseGameLoopParams));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(local).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    unmount();
    expect(write).toHaveBeenCalledOnce();
  });

  it('blocks automatic/basic/queued legacy work under Strict Mode while owned', () => {
    const rpc = vi.spyOn(supabase, 'rpc');
    const invoke = vi.fn();
    vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke } as never);
    const params = { character, creatures: [{ id: 'c', hp: 10, is_alive: true, is_aggressive: true }], party: null, isLeader: true, isDead: false, addLocalLogEvent: vi.fn(), updateCharacter: vi.fn(), fetchGroundLoot: vi.fn(), enabled: false } as unknown as UseCombatDriverParams;
    const { result } = renderHook(() => useCombatDriver(params), { wrapper: StrictMode });
    act(() => { result.current.startCombat('c'); result.current.queueAbility(0, 'c'); result.current.stopCombat(); });
    expect(rpc).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not retry or apply an in-flight legacy tick after suspension', async () => {
    vi.useFakeTimers();
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: null } as never);
    let finish!: (response: unknown) => void;
    const invoke = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    vi.spyOn(supabase, 'functions', 'get').mockReturnValue({ invoke } as never);
    const local = vi.fn();
    const params = { character, creatures: [], party: null, isLeader: true, isDead: false, addLocalLogEvent: vi.fn(), updateCharacter: vi.fn(), updateCharacterLocal: local, fetchGroundLoot: vi.fn() } as unknown as UseCombatDriverParams;
    const { result, rerender, unmount } = renderHook(({ enabled }) => useCombatDriver({ ...params, enabled }), { initialProps: { enabled: true } });
    await act(async () => { result.current.startCombat('c'); });
    expect(result.current.inCombat).toBe(true);
    expect(result.current.engagedCreatureIds).toEqual(['c']);
    await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
    expect(invoke).toHaveBeenCalledOnce();
    rerender({ enabled: false });
    await act(async () => { finish({ data: null, error: { message: 'temporarily unavailable', context: { status: 503 } } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(invoke).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['join_encounter_engagement']);
    expect(local).not.toHaveBeenCalled();
    expect(result.current.inCombat).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it('blocks legacy ability and equipment mutations, including saved callbacks', async () => {
    const rpc = vi.spyOn(supabase, 'rpc');
    const from = vi.spyOn(supabase, 'from');
    const start = vi.fn();
    const params = { character, isDead: false, equipped: [], startCombat: start, buffState: {} } as unknown as UseCombatActionsParams;
    const { result, rerender } = renderHook(({ enabled }) => useCombatActions({ ...params, enabled }), { initialProps: { enabled: true } });
    const old = result.current;
    rerender({ enabled: false });
    await act(async () => { old.handleAttack('c'); await old.handleUseAbility(0); await old.degradeEquipment(); });
    expect(start).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
