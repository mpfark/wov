import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminCharacterSheet from './AdminCharacterSheet';
import CharacterActionsColumn from './CharacterActionsColumn';
vi.mock('../ItemPicker', () => ({ default: () => null }));
vi.mock('../NodePicker', () => ({ default: () => null }));
vi.mock('./CharacterSummaryCard', () => ({ default: () => null }));
vi.mock('./AdminEquipSlot', () => ({ default: () => null }));
const character = { id: 'char', name: 'Test', gender: 'male', level: 1, class: 'classless', race: 'human',
  hp: 10, max_hp: 16, cp: 30, max_cp: 30, gold: 200, xp: 0, ac: 9,
  str: 9, dex: 9, con: 9, int: 9, wis: 9, cha: 9, unspent_stat_points: 0, inventory: [], current_node_id: null } as any;
afterEach(cleanup);
it('keeps name editing but removes the level editor', () => {
  const edit = vi.fn();
  render(<TooltipProvider><AdminCharacterSheet c={character} isEditing charEdits={{}} setCharEdits={edit}
    onEdit={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} /></TooltipProvider>);
  expect(screen.getByText('Progression fields are read-only.')).toBeInTheDocument();
  const name = screen.getByDisplayValue('Test'); fireEvent.change(name, { target: { value: 'Changed' } });
  expect(edit).toHaveBeenCalled();
  expect(screen.queryByDisplayValue('1')).toBeNull();
  expect(screen.queryByDisplayValue('200')).toBeNull();
});
it('disables raw respec/reset and paused XP and all D2 convenience actions', () => {
  const callbacks = { onGrantXp: vi.fn(), onGrantRespec: vi.fn(), onResetStats: vi.fn(), onGrantGold: vi.fn(), onGiveItem: vi.fn(), onRemoveItem: vi.fn(), onTeleport: vi.fn(), onRevive: vi.fn(), onGrantSalvage: vi.fn(), onGrantGem: vi.fn() };
  const props: any = { selectedChar: { ...character, inventory: [{ id: 'inv', item: { name: 'Test item', rarity: 'common' } }] }, selectedUser: null, allItems: [], allNodes: [], allRegions: [], allAreas: [],
    giveItemId: '', teleportNodeId: '', grantXpAmount: 1, grantRespecAmount: 1, grantSalvageAmount: 1,
    grantGoldAmount: 1, grantGemKey: 'garnet', grantGemAmount: 1, removeItemId: '', ...callbacks };
  render(<CharacterActionsColumn {...props} />);
  for (const label of ['Grant XP', 'Grant Respec', 'Reset Stats', 'Grant Gold', 'Grant Salvage', 'Grant Gem', 'Give', 'Tp', 'Rm', 'Revive (10/16)']) {
    const button = screen.getByRole('button', { name: label }); expect(button).toBeDisabled(); fireEvent.click(button);
  }
  expect(callbacks.onGrantXp).not.toHaveBeenCalled(); expect(callbacks.onGrantRespec).not.toHaveBeenCalled();
  expect(callbacks.onResetStats).not.toHaveBeenCalled();
  const gold = screen.getByRole('button', { name: 'Grant Gold' }); expect(gold).toBeDisabled(); fireEvent.click(gold);
  for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
});

vi.mock('@/contexts/GameContext', () => ({ useGameContext: () => ({}) }));
vi.mock('@/lib/supabase-paginate', () => ({ fetchAllRows: async () => [] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) },
  from: () => ({ select: () => ({ data: [], order: async () => ({ data: [] }) }) }),
} }));
vi.mock('./UserListColumn', () => ({ default: ({ users, onSelectUser }: any) => <button onClick={() => onSelectUser(users[0].id)} disabled={!users.length}>Select account</button> }));
vi.mock('./CharacterListColumn', () => ({ default: () => null }));
vi.mock('./CharacterSheetColumn', () => ({ default: () => null }));
vi.mock('./CharacterLifecycleControls', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import UserManager from './UserManager';
import { toast } from 'sonner';
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
for (const [overlord, cap] of [[false, 1], [true, 5]] as const) {
  it(`renders reason entry, enforces cap ${cap}, retries UUID and resets new intent`, async () => {
    const awards: any[] = []; let lists = 0; let finish: ((value: any) => void) | undefined;
    let outcome = 'committed';
    const request = vi.fn(async (url: string, options: any) => {
      if (url.includes('action=list')) { lists++; return { ok: true, json: async () => ({ users: [{ id: 'account', characters: [character] }], total: 1 }) }; }
      awards.push(JSON.parse(options.body));
      if (awards.length === 1) await new Promise(resolve => { finish = resolve; });
      return { ok: outcome !== 'refused', json: async () => outcome === 'refused' ? { kind: 'refused', reason: 'invalid_target' } : { kind: outcome } };
    });
    vi.stubGlobal('fetch', request);
    render(<UserManager isValar={overlord} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select account' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Select account' }));
    const reason = await screen.findByRole('textbox', { name: 'Token award reason' });
    const amount = screen.getByRole('spinbutton', { name: 'Token amount' });
    const award = screen.getByRole('button', { name: 'Grant Respec' });
    expect(award).toBeDisabled();
    fireEvent.change(reason, { target: { value: '   ' } }); expect(award).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'x'.repeat(1001) } }); expect(award).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'Support correction' } }); expect(award).not.toBeDisabled();
    for (const invalid of [0, cap + 1, 1.5]) { fireEvent.change(amount, { target: { value: invalid } }); expect(award).toBeDisabled(); }
    fireEvent.change(amount, { target: { value: cap } }); expect(award).not.toBeDisabled();
    fireEvent.click(award); fireEvent.click(award);
    await waitFor(() => expect(awards).toHaveLength(1)); expect(award).toBeDisabled();
    finish!({});
    await waitFor(() => expect(award).not.toBeDisabled()); expect(lists).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('Respec tokens awarded');
    outcome = 'replayed'; fireEvent.click(award);
    await waitFor(() => expect(lists).toBe(3));
    expect(awards[1].request_id).toBe(awards[0].request_id);
    expect(toast.success).toHaveBeenCalledWith('Original token award confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'New token award' }));
    expect(reason).toHaveValue(''); expect(amount).toHaveValue(1); expect(award).toBeDisabled();
    fireEvent.change(reason, { target: { value: 'Support correction' } });
    fireEvent.change(amount, { target: { value: cap } });
    outcome = 'refused'; fireEvent.click(award);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('invalid_target'));
    expect(awards[2].request_id).not.toBe(awards[0].request_id); expect(lists).toBe(3);
    outcome = 'committed'; fireEvent.click(award);
    await waitFor(() => expect(lists).toBe(4));
    expect(awards[3].request_id).toBe(awards[2].request_id);
    for (const label of ['Grant XP', 'Grant Gold', 'Grant Salvage', 'Grant Gem', 'Give', 'Tp']) expect(screen.getByRole('button', { name: label })).toBeDisabled();
    request.mockRejectedValueOnce(new Error('Network unavailable')); fireEvent.click(award);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network unavailable'));
  });
}
