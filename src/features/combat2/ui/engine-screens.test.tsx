import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EngineCreatureRoster } from './EngineCreatureRoster';
import { EngineSpellbook } from './EngineSpellbook';
import type { Creature } from '@/features/creatures';
import type { AbilityLoadoutState } from '@/hooks/useAbilityLoadout';

const creature: Creature = { id: 'wolf', name: 'Wolf', description: '', node_id: 'node', rarity: 'regular', level: 1,
  hp: 20, max_hp: 20, stats: {}, ac: 10, is_aggressive: false, loot_table: [], is_alive: true,
  respawn_seconds: 60, died_at: null, loot_table_id: null, drop_chance: 0, spawn_seq: 2 };
function roster(overrides: Partial<Parameters<typeof EngineCreatureRoster>[0]> = {}) {
  const onAttack = vi.fn(); const onSelectTarget = vi.fn();
  render(<EngineCreatureRoster creatures={[creature]} rosterActionable engagedIds={[]} hpOverrides={{}}
    encounterTick={1} onAttack={onAttack} onSelectTarget={onSelectTarget} {...overrides} />);
  return { onAttack, onSelectTarget };
}
describe('engine creature commands', () => {
  it('separates target selection from the authoritative attack command', () => {
    const commands = roster();
    fireEvent.click(screen.getByRole('button', { name: 'Target Wolf' }));
    expect(commands.onSelectTarget).toHaveBeenCalledWith('wolf');
    expect(commands.onAttack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    expect(commands.onAttack).toHaveBeenCalledExactlyOnceWith('wolf');
  });
  it('does not submit an attack from an unconfirmed roster', () => {
    const commands = roster({ rosterActionable: false });
    fireEvent.click(screen.getByRole('button', { name: 'Attack' }));
    expect(commands.onAttack).not.toHaveBeenCalled();
  });
  it('does not offer another attack for an engaged or pending identity', () => {
    roster({ engagedIds: ['wolf'] });
    expect(screen.queryByRole('button', { name: 'Attack' })).toBeNull();
  });
  it('does not let a dead identity be selected or attacked', () => {
    const commands = roster({ hpOverrides: { wolf: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Target Wolf' }));
    expect(commands.onSelectTarget).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Attack' })).toBeNull();
  });
});
const option = (id: string, levelRequired = 1) => ({ abilityId: id, abilityKey: id, damageType: 'fire', isDefault: id === 'fireball', calc: {},
  ability: { abilityKey: id, label: id, description: '', tooltip: '', cpCost: 10, type: 'spell_attack' as const,
    tier: 0, levelRequired, targetType: 'enemy', damageType: 'fire' } });
function spellbook(overrides: Partial<Parameters<typeof EngineSpellbook>[0]> = {}) {
  const select = vi.fn().mockResolvedValue(undefined);
  const loadout: AbilityLoadoutState = { roles: [], allRoles: [{ roleId: 'signature', name: 'Signature', slot: 1, unlockLevel: 1,
    options: [option('fireball'), option('frost_bolt')] }], selections: {}, loading: false, saving: false, error: null, select };
  render(<EngineSpellbook level={20} loadout={loadout} {...overrides} />);
  return { select, loadout };
}
describe('engine spellbook commands', () => {
  it('submits the exact configured role and alternate ability', () => {
    const { select } = spellbook();
    fireEvent.click(screen.getByRole('button', { name: /frost_bolt/ }));
    expect(select).toHaveBeenCalledExactlyOnceWith('signature', 'frost_bolt');
  });
  it('does not change loadout during combat', () => {
    const { select } = spellbook({ inCombat: true });
    fireEvent.click(screen.getByRole('button', { name: /frost_bolt/ }));
    expect(select).not.toHaveBeenCalled();
  });
  it('does not submit an option below its configured unlock', () => {
    const { select } = spellbook({ level: 0 });
    fireEvent.click(screen.getByRole('button', { name: /frost_bolt/ }));
    expect(select).not.toHaveBeenCalled();
  });
});
