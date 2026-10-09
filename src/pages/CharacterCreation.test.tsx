import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import CharacterCreation from './CharacterCreation';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => { sessionStorage.clear(); mock.rpc.mockResolvedValue({ data: { retained: 0, limit: 5 }, error: null }); });
afterEach(cleanup);
describe('C2 creation form', () => {
  it('submits choices only, preserves capitalization and never assigns a family', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'created' }), ready = vi.fn();
    await act(async () => { render(<CharacterCreation actorId="actor" onCreateCharacter={create} onCharacterReady={ready} />); });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ÉLdrin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Wayfarer' })); });
    expect(create).toHaveBeenCalledWith({ name: 'ÉLdrin', race: 'human', gender: 'male' });
    expect(ready).toHaveBeenCalledWith('created');
    expect(screen.queryByPlaceholderText(/Family name/)).toBeNull();
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it('counts retained tombstones and blocks new requests at five slots', async () => {
    mock.rpc.mockResolvedValue({ data: { retained: 5, limit: 5 }, error: null });
    const create = vi.fn();
    await act(async () => { render(<CharacterCreation actorId="actor" onCreateCharacter={create} />); });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Eldrin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(screen.getByRole('button', { name: 'Create Wayfarer' })).toBeDisabled();
    expect(screen.getByText(/5 of 5 account slots/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
  it('requires delegation reason and passes target without client-authored stats', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'created' });
    await act(async () => { render(<CharacterCreation actorId="overlord" targetAccount="recipient" onCreateCharacter={create} />); });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Eldrin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(screen.getByRole('button', { name: 'Create Wayfarer' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Delegation reason'), { target: { value: 'Approved repair' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create Wayfarer' })); });
    expect(create).toHaveBeenCalledWith({ name: 'Eldrin', race: 'human', gender: 'male', targetAccount: 'recipient', reason: 'Approved repair' });
  });
});
