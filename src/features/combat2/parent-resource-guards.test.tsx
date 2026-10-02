import { act, render, renderHook, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameRoute from '@/pages/GameRoute';
import { useCharacter } from '@/features/character/hooks/useCharacter';

const mocks = vi.hoisted(() => ({ restricted: true, combat2: true, rpc: vi.fn(), refetch: vi.fn(), row: { id: 'test-character', reserved_buffs: { force_shield: {} } } }));
vi.mock('@/shared/config/feature-flags', () => ({ get COMBAT2_CLIENT_ENABLED() { return mocks.combat2; } }));
vi.mock('./test-config', () => ({ combat2ArenaReservesLegacy: () => mocks.restricted }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [mocks.row], error: null }) }) }) }),
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
vi.mock('@/contexts/GameContext', () => ({ useGameContext: () => ({ user: { id: 'user' }, character: mocks.row, refetchCharacters: mocks.refetch, nodes: [] }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/pages/GamePage', () => ({ default: () => <p>Game mounted</p> }));
beforeEach(() => { mocks.restricted = true; mocks.combat2 = true; mocks.row.id = 'test-character'; mocks.refetch.mockClear(); mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null }); sessionStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe('pre-page legacy resource suppression', () => {
  it('mounts the configured test without clearing stances or syncing legacy resources', async () => {
    render(<StrictMode><GameRoute /></StrictMode>);
    expect(await screen.findByText('Game mounted')).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves authoritative resource sync without legacy stance clearing on ordinary Combat2 entry', async () => {
    mocks.restricted = false;
    render(<StrictMode><GameRoute /></StrictMode>);
    expect(await screen.findByText('Game mounted')).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['sync_character_resources']);
  });
  it('retains first-entry legacy compatibility only when Combat2 is explicitly off', async () => {
    mocks.restricted = false;
    mocks.combat2 = false;
    render(<StrictMode><GameRoute /></StrictMode>);
    expect(await screen.findByText('Game mounted')).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['clear_stances', 'sync_character_resources']);
  });
  it('discards entry completions for a previous character without refetching or marking its session synced', async () => {
    mocks.restricted = false;
    let finishOld!: (result: unknown) => void;
    mocks.rpc.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const { rerender } = render(<GameRoute />);
    mocks.row = { ...mocks.row, id: 'new-character' };
    rerender(<GameRoute />);
    expect(await screen.findByText('Game mounted')).toBeInTheDocument();
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('wov:entrySynced:test-character')).toBeNull();
    mocks.row = { ...mocks.row, id: 'test-character' };
    rerender(<GameRoute />);
    await act(async () => {});
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    await act(async () => finishOld({ data: null, error: null }));
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('wov:entrySynced:test-character')).toBe('1');
    expect(sessionStorage.getItem('wov:entrySynced:new-character')).toBe('1');
  });
  it('never runs browser Force Shield regeneration outside combat or across ownership/session transitions', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('selectedCharacterId', 'test-character');
    const user = { id: 'user' } as Parameters<typeof useCharacter>[0];
    const { result, rerender, unmount } = renderHook(() => useCharacter(user));
    await act(async () => {});
    expect(result.current.character?.id).toBe('test-character');
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.restricted = false;
    rerender();
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_force_shield_regen')).toEqual([]);
    act(() => result.current.updateCharacterLocal({ current_node_id: 'encounter-node' }));
    mocks.restricted = true;
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    act(() => result.current.clearSelectedCharacter());
    expect(result.current.character).toBeNull();
    act(() => result.current.selectCharacter('test-character'));
    mocks.restricted = false;
    rerender();
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(result.current.character?.id).toBe('test-character');
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'apply_force_shield_regen')).toEqual([]);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
