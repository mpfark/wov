import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMovementActions, type UseMovementActionsParams } from '@/features/world/hooks/useMovementActions';
import { guardControlledAction, MOVEMENT_UNAVAILABLE } from './controlled-actions';

vi.mock('@/features/creatures/hooks/useCreatures', () => ({ preheatNode: vi.fn() }));
vi.mock('@/features/world/utils/visitedNodesCache', () => ({ markNodeVisited: vi.fn() }));

function params() {
  const write = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  const node = { id: 'node', region_id: 'region', connections: [] };
  const options = {
    character: { id: 'character', name: 'Tester', current_node_id: 'node', hp: 10, mp: 100, cp: 100, str: 10, level: 10 },
    updateCharacter: write, addLogEvent: log, equipped: [], unequipped: [], equipmentBonuses: {},
    getNode: () => node, getRegion: () => ({ id: 'region' }), getNodeArea: () => null, currentNode: node,
    creatures: [], party: null, partyMembers: [], isLeader: false, inCombat: true, isDead: false,
    fleeStopCombat: vi.fn(), buffState: {}, buffSetters: {}, broadcastMove: vi.fn(),
  } as unknown as UseMovementActionsParams;
  return { options, write, log };
}

describe('controlled test movement lock', () => {
  it('routes ordinary movement authoritatively while teleport, waymark and search remain blocked', async () => {
    const { options, write, log } = params();
    const flee = vi.fn();
    const depart = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMovementActions({ ...options, movementBlocked: true, authorizeCombat2Flee: flee, authorizeCombat2Depart: depart }));
    await act(async () => {
      await result.current.handleMove('other');
      await result.current.handleTeleport('other', 1);
      await result.current.handleReturnToWaymark(1);
      await result.current.handleSearch();
    });
    expect(write).not.toHaveBeenCalled();
    expect(flee).not.toHaveBeenCalled();
    expect(depart).toHaveBeenCalledExactlyOnceWith('other', expect.any(String));
    expect(log).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(log.mock.calls)).toContain(MOVEMENT_UNAVAILABLE);
  });

  it.each([true, false])('invalidates a saved flee/movement continuation (flee returned %s)', async result => {
    const { options, write } = params();
    let finish!: (value: boolean) => void;
    const flee = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const { result: hook, rerender } = renderHook(({ blocked }) => useMovementActions({ ...options, movementBlocked: blocked, authorizeCombat2Flee: flee }), { initialProps: { blocked: false } });
    let pending!: Promise<void>;
    act(() => { pending = hook.current.handleMove('other'); });
    expect(flee).toHaveBeenCalledOnce();
    rerender({ blocked: true });
    await act(async () => { finish(result); await pending; });
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['summon acceptance', 'follow initiation', 'party creation', 'party invitation'])('blocks %s through the shared callback guard', async () => {
    const action = vi.fn();
    const diagnose = vi.fn();
    let allowed = true;
    const saved = guardControlledAction(() => allowed, diagnose, action);
    allowed = false;
    await saved();
    expect(action).not.toHaveBeenCalled();
    expect(diagnose).toHaveBeenCalledWith(MOVEMENT_UNAVAILABLE);
    allowed = true;
    await saved();
    expect(action).toHaveBeenCalledOnce();
  });
});
