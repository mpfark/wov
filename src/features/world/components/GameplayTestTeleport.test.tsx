import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GameplayTestTeleport from './GameplayTestTeleport';
const { invoke, context } = vi.hoisted(() => ({ invoke: vi.fn(), context: { user: { id: '00000000-0000-4000-8000-000000000001' } } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/contexts/GameContext', () => ({ useGameContext: () => context }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/admin/NodePicker', () => ({ default: ({ onChange, nodes }: any) => <button onClick={() => onChange(nodes[0].id)}>Choose approved node</button> }));
const char = '00000000-0000-4000-8000-000000000002', node = '00000000-0000-4000-8000-000000000003';
beforeEach(() => { sessionStorage.clear(); invoke.mockReset(); }); afterEach(cleanup);
it('lists only approved destinations; explicit selection and click perform the mutation then refresh', async () => {
  const refresh = vi.fn();
  invoke.mockImplementation(async (route: string, { body }: any) => route.endsWith('access') ?
    { data: { destinations: [{ id: node, name: 'Fixture', region_id: node }] }, error: null } :
    { data: { ...body, ok: true, outcome: 'committed' }, error: null });
  render(<GameplayTestTeleport characterId={char} onMoved={refresh} />);
  await screen.findByText('Choose approved node'); expect(invoke).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Test teleport')).toBeDisabled();
  fireEvent.click(screen.getByText('Choose approved node')); fireEvent.click(screen.getByText('Test teleport'));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(invoke.mock.calls[1][0]).toBe('admin-users?action=test-teleport');
});
it('normal accounts get no travel control and never send a mutation', async () => {
  invoke.mockResolvedValue({ data: { destinations: [] }, error: null });
  render(<GameplayTestTeleport characterId={char} onMoved={vi.fn()} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledOnce());
  expect(screen.queryByText('Test teleport')).toBeNull();
});
