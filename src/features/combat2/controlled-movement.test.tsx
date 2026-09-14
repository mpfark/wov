import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMovementActions, type UseMovementActionsParams } from '@/features/world/hooks/useMovementActions';
import { guardControlledAction, MOVEMENT_UNAVAILABLE } from './controlled-actions';
import { supabase } from '@/integrations/supabase/client';
import fs from 'node:fs';

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
  afterEach(() => vi.restoreAllMocks());

  it('revalidates a visible party against server authority instead of trusting the legacy roster',()=>{
    const page=fs.readFileSync('src/pages/GamePage.tsx','utf8');
    expect(page).toContain('checkCombat2SessionPreflight(character.id,character.current_node_id)');
    expect(page).toContain('if(current&&!allowed)ownership.lock()');
    expect(page).not.toContain('if (combat2BlocksLegacy && (party || myMembership?.is_following)) ownership.lock()');
  });
  it('routes ordinary movement authoritatively while active-combat teleport remains refused', async () => {
    const { options, write, log } = params();
    const flee = vi.fn();
    const depart = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMovementActions({ ...options, movementBlocked: true, authorizeCombat2Flee: flee, authorizeCombat2Depart: depart }));
    await act(async () => {
      await result.current.handleMove('other');
      await result.current.handleTeleport('other', 1);
    });
    expect(write).not.toHaveBeenCalled();
    expect(flee).not.toHaveBeenCalled();
    expect(depart).toHaveBeenCalledExactlyOnceWith('other', expect.any(String));
    expect(JSON.stringify(log.mock.calls)).toContain('cannot teleport while in combat');
    expect(JSON.stringify(log.mock.calls)).not.toContain(MOVEMENT_UNAVAILABLE);
  });

  it('single-flights authoritative special travel and refreshes instead of writing location locally', async () => {
    const { options, write, log } = params();
    const refreshCharacter = vi.fn().mockResolvedValue(undefined);
    let finish!: (value: unknown) => void;
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation(((name: string) => {
      if (name === 'hidden_path_openings') return Promise.resolve({ data: [], error: null });
      return new Promise(resolve => { finish = resolve; });
    }) as unknown as typeof supabase.rpc);
    const { result } = renderHook(() => useMovementActions({
      ...options, inCombat: false, movementBlocked: true, refreshCharacter,
      getNode: (id: string) => ({ id, name: id === 'other' ? 'Elsewhere' : 'Origin', region_id: 'region', connections: [] }),
    }));
    let first!: Promise<void>;
    act(() => {
      first = result.current.handleTeleport('other', 1);
      void result.current.handleTeleport('other', 1);
    });
    expect(rpc.mock.calls.filter(([name]) => name === 'character_special_travel')).toHaveLength(1);
    await act(async () => {
      finish({ data: { ok: true, kind: 'moved', destination_node_id: 'other', cp_cost: 1 }, error: null });
      await first;
    });
    expect(write).not.toHaveBeenCalled();
    expect(refreshCharacter).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain('You teleport to Elsewhere');
  });

  it('discards a special-travel response after the authoritative character location changes', async () => {
    const { options, write, log } = params();
    const refreshCharacter = vi.fn();
    let finish!: (value: unknown) => void;
    vi.spyOn(supabase, 'rpc').mockImplementation(((name: string) => {
      if (name === 'hidden_path_openings') return Promise.resolve({ data: [], error: null });
      return new Promise(resolve => { finish = resolve; });
    }) as unknown as typeof supabase.rpc);
    const { result, rerender } = renderHook(({ nodeId }) => useMovementActions({
      ...options, inCombat: false, movementBlocked: true, refreshCharacter,
      character: { ...options.character, current_node_id: nodeId },
      getNode: (id: string) => ({ id, name: id, region_id: 'region', connections: [] }),
    }), { initialProps: { nodeId: 'node' } });
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleTeleport('other', 1); });
    rerender({ nodeId: 'new-node' });
    await act(async () => {
      finish({ data: { ok: true, kind: 'moved', destination_node_id: 'other', cp_cost: 1 }, error: null });
      await pending;
    });
    expect(write).not.toHaveBeenCalled();
    expect(refreshCharacter).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
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
