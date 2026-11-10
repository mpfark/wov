import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EngineActionBar } from './EngineActionBar';
import { CLASS_ABILITIES, resetAbilityRegistry, setClassAbilityList } from './class-abilities';
import { CLASS_ABILITIES as compatibilityRegistry } from '@/features/combat/utils/class-abilities';
import { resolveStanceForAbility, getStanceReserveCost } from './stances';

afterEach(resetAbilityRegistry);
const ability = { abilityKey: 'fireball', label: 'Fireball', description: '', tooltip: '', cpCost: 10,
  type: 'spell_attack' as const, tier: 0, levelRequired: 1, damageType: 'fire', targetType: 'enemy' };
function bar(overrides: Partial<Parameters<typeof EngineActionBar>[0]> = {}) {
  const command = vi.fn();
  render(<TooltipProvider><EngineActionBar abilities={[ability]}
    character={{ id: 'player', hp: 20, cp: 50, level: 20 }} creatures={[{ id: 'creature', is_alive: true }]}
    selectedTargetId="creature" availableCp={50} actionsReady pendingIndex={null} pendingStage={null}
    reservations={{}} onUseAbility={command} {...overrides} /></TooltipProvider>);
  return command;
}
describe('engine-owned player commands', () => {
  it('submits the selected living identity through the provided authoritative command', () => {
    const command = bar();
    fireEvent.click(screen.getByRole('button', { name: 'Fireball' }));
    expect(command).toHaveBeenCalledWith(0, 'creature');
  });
  it('does not submit while authoritative delivery refuses readiness', () => {
    const command = bar({ getReadiness: () => ({ ready: false, reason: 'movement_pending', message: 'Movement is pending' }) });
    fireEvent.click(screen.getByRole('button', { name: /Fireball/ }));
    expect(command).not.toHaveBeenCalled();
  });
  it('keeps zero-spendable-CP stance dropping available through session readiness', () => {
    const command = bar({ abilities: [{ ...ability, abilityKey: 'force_shield', targetType: 'self', type: 'absorb_buff' }],
      availableCp: 0, reservations: { force_shield: { tier: 1, reserved: 5, activated_at: 0 } }, getReadiness: () => ({ ready: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Fireball' }));
    expect(command).toHaveBeenCalledWith(0, 'player');
  });
  it('shares one mutable registry with compatibility consumers rather than a second loadout', () => {
    setClassAbilityList('wizard', [ability]);
    expect(compatibilityRegistry).toBe(CLASS_ABILITIES);
    expect(compatibilityRegistry.wizard[0].abilityKey).toBe('fireball');
  });
  it('preserves identity-aware wards and existing 10/15/20 percent reservation presentation', () => {
    expect(resolveStanceForAbility({ abilityKey: 'divine_aegis', type: 'absorb_buff', targetType: 'ally' })).toBeNull();
    expect([1, 2, 3].map(t => getStanceReserveCost(t as 1 | 2 | 3, 100))).toEqual([10, 15, 20]);
  });
});