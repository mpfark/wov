import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
it('keeps name/gold editing but removes the level editor', () => {
  const edit = vi.fn();
  render(<TooltipProvider><AdminCharacterSheet c={character} isEditing charEdits={{}} setCharEdits={edit}
    onEdit={vi.fn()} onSave={vi.fn()} onCancel={vi.fn()} /></TooltipProvider>);
  expect(screen.getByText('Progression fields are read-only.')).toBeInTheDocument();
  const name = screen.getByDisplayValue('Test'); fireEvent.change(name, { target: { value: 'Changed' } });
  expect(edit).toHaveBeenCalled();
  expect(screen.queryByDisplayValue('1')).toBeNull();
  expect(screen.getByDisplayValue('200')).toBeInTheDocument();
});
it('disables raw respec/reset and paused XP while leaving unrelated actions available', () => {
  const callbacks = { onGrantXp: vi.fn(), onGrantRespec: vi.fn(), onResetStats: vi.fn(), onGrantGold: vi.fn() };
  const props: any = { selectedChar: character, selectedUser: null, allItems: [], allNodes: [], allRegions: [], allAreas: [],
    giveItemId: '', teleportNodeId: '', grantXpAmount: 1, grantRespecAmount: 1, grantSalvageAmount: 1,
    grantGoldAmount: 1, grantGemKey: 'garnet', grantGemAmount: 1, removeItemId: '', ...callbacks };
  render(<CharacterActionsColumn {...props} />);
  for (const label of ['Grant XP', 'Grant Respec', 'Reset Stats']) {
    const button = screen.getByRole('button', { name: label }); expect(button).toBeDisabled(); fireEvent.click(button);
  }
  expect(callbacks.onGrantXp).not.toHaveBeenCalled(); expect(callbacks.onGrantRespec).not.toHaveBeenCalled();
  expect(callbacks.onResetStats).not.toHaveBeenCalled();
  const gold = screen.getByRole('button', { name: 'Grant Gold' }); expect(gold).not.toBeDisabled(); fireEvent.click(gold);
  expect(callbacks.onGrantGold).toHaveBeenCalledWith('char');
});
