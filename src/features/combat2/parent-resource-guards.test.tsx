import { act, render, renderHook, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameRoute from '@/pages/GameRoute';
import { useCharacter } from '@/features/character/hooks/useCharacter';

const mocks = vi.hoisted(() => ({ restricted: true, rpc: vi.fn(), refetch: vi.fn(), row: { id: 'test-character', reserved_buffs: { force_shield: {} } } }));
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
beforeEach(() => { mocks.restricted = true; mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null }); sessionStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe('pre-page legacy resource suppression', () => {
  it('mounts the configured test without clearing stances or syncing legacy resources', async () => {
    render(<StrictMode><GameRoute /></StrictMode>);
    expect(await screen.findByText('Game mounted')).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves ordinary entry RPCs outside the controlled test', async () => {
    mocks.restricted = false;
    render(<StrictMode><GameRoute /></StrictMode>);
    expect(await screen.findByText('Game mounted')).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(['clear_stances', 'sync_character_resources']);
  });
  it('suspends Force Shield regen but retains character loading and selection', async () => {
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
    expect(mocks.rpc).toHaveBeenCalledWith('apply_force_shield_regen', { _character_id: 'test-character' });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
