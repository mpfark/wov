import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import GameRoute from './GameRoute';

const fixture = vi.hoisted(() => ({
  state: { user: { id: 'owner', email_confirmed_at: 'confirmed' }, character: null as null | { id: string; current_node_id: string },
    authLoading: false, charLoading: false, nodesLoading: false, nodes: [], startingNode: undefined,
    clearSelectedCharacter: vi.fn(), refetchCharacters: vi.fn() },
  rpc: vi.fn(),
}));
vi.mock('@/contexts/GameContext', () => ({ useGameContext: () => fixture.state }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: fixture.rpc } }));
vi.mock('./GamePage', () => ({ default: () => <div>Engine game mounted</div> }));
vi.mock('@/features/combat2/test-config', () => ({ combat2ArenaReservesLegacy: (node: string) => node === 'arena' }));
const route = () => <StrictMode><MemoryRouter initialEntries={['/game']}><Routes>
  <Route path="/game" element={<GameRoute />} /><Route path="/" element={<div>Choose character</div>} />
</Routes></MemoryRouter></StrictMode>;
beforeEach(() => { fixture.state.character = null; fixture.rpc.mockReset().mockResolvedValue({ error: null }); sessionStorage.clear(); });
describe('engine player entry', () => {
  it('redirects an authenticated unselected player instead of leaving a blank route', async () => {
    render(route());
    expect(await screen.findByText('Choose character')).toBeInTheDocument();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('prepares a selected character once under Strict Mode', async () => {
    fixture.state.character = { id: 'a', current_node_id: 'ordinary' };
    render(route());
    expect(await screen.findByText('Engine game mounted')).toBeInTheDocument();
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('sync_character_resources', { p_character_id: 'a' });
  });
  it('does not claim readiness after an RPC refusal and permits explicit retry', async () => {
    fixture.state.character = { id: 'a', current_node_id: 'ordinary' };
    fixture.rpc.mockResolvedValueOnce({ error: { message: 'refused' } });
    render(route());
    await screen.findByRole('alert');
    expect(screen.queryByText('Engine game mounted')).toBeNull();
    expect(sessionStorage.getItem('wov:entrySynced:a')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Engine game mounted')).toBeInTheDocument();
  });
  it('restarts invalidated same-character entry and ignores stale completion', async () => {
    let completeOld: (value: { error: null }) => void = () => {};
    let completeNew: (value: { error: null }) => void = () => {};
    fixture.rpc.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { completeNew = resolve; }));
    fixture.state.character = { id: 'a', current_node_id: 'ordinary' };
    const view = render(route());
    fixture.state.character = { id: 'a', current_node_id: 'arena' }; view.rerender(route());
    fixture.state.character = { id: 'a', current_node_id: 'ordinary' }; view.rerender(route());
    await waitFor(() => expect(fixture.rpc).toHaveBeenCalledTimes(2));
    completeOld({ error: null });
    await waitFor(() => expect(screen.queryByText('Engine game mounted')).toBeNull());
    completeNew({ error: null });
    expect(await screen.findByText('Engine game mounted')).toBeInTheDocument();
  });
});