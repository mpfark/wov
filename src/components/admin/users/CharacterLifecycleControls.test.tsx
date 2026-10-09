import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterLifecycleControls from './CharacterLifecycleControls';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/contexts/GameContext', () => ({ useGameContext: () => ({ user: { id: 'overlord' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const now = Date.parse('2026-10-09T12:00:00Z');
const target = { id: 'recipient', characters: [] } as any;
const deleted = { id: 'char', deleted_at: '2026-10-01T12:00:00Z',
  restore_until: '2026-10-31T12:00:00Z', lifecycle_version: 1 } as any;
beforeEach(() => { sessionStorage.clear(); mocks.rpc.mockReset(); vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Overlord lifecycle UI integration', () => {
  it('requires reason and calls only lifecycle command before refreshing authoritative list', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: { kind: 'restored', characterId: 'char' }, error: null });
    render(<CharacterLifecycleControls target={target} character={deleted} refresh={refresh} />);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Lifecycle reason'), { target: { value: 'Approved recovery' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore' })); });
    expect(mocks.rpc).toHaveBeenCalledWith('character_lifecycle_command', expect.objectContaining({
      _character: 'char', _expected_version: 1, _operation: 'restore', _reason: 'Approved recovery' }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('c2-lifecycle:overlord:char')).toBeNull();
  });
  it('requires elapsed deadline and explicit permanent-purge confirmation', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
    mocks.rpc.mockResolvedValue({ data: { kind: 'purged', characterId: 'char' }, error: null });
    render(<CharacterLifecycleControls target={target} character={deleted} refresh={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.change(screen.getByLabelText('Lifecycle reason'), { target: { value: 'Expired tombstone' } });
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Permanently purge' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Permanently purge' })); });
    expect(mocks.rpc.mock.calls[0][1]._operation).toBe('purge');
  });
  it('read failure retains bound UUID/version and allows exact restoration retry after deadline', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('list unavailable')).mockResolvedValue(undefined);
    mocks.rpc.mockResolvedValue({ data: { kind: 'restored', characterId: 'char' }, error: null });
    const props = { target, character: deleted, refresh };
    const rendered = render(<CharacterLifecycleControls {...props} />);
    fireEvent.change(screen.getByLabelText('Lifecycle reason'), { target: { value: 'Recovery' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('list unavailable');
    const original = mocks.rpc.mock.calls[0];
    rendered.unmount();
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));
    render(<CharacterLifecycleControls {...props} />);
    expect(screen.getByLabelText('Lifecycle reason')).toHaveValue('Recovery');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry restoration' })); });
    expect(mocks.rpc.mock.calls[1]).toEqual(original);
  });
  it('definite server refusal never falls back to legacy deletion or generic admin UPDATE', async () => {
    const refresh = vi.fn();
    mocks.rpc.mockResolvedValue({ error: { code: '42501', message: 'lifecycle_not_authorized' } });
    render(<CharacterLifecycleControls target={target} character={deleted} refresh={refresh} />);
    fireEvent.change(screen.getByLabelText('Lifecycle reason'), { target: { value: 'Recovery' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore' })); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1); expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('not_authorized');
  });
});
