import { describe, it, expect, beforeEach } from 'vitest';
import {
  setLoadoutOptions, getLoadoutRoles, getRolesWithAlternatives, hasLoadoutOptions,
  applyAbilityLoadout, resetLoadoutOptions,
} from '../ability-loadout';
import {
  CLASS_ABILITIES, resetAbilityRegistry, type AbilityConfigRow,
} from '../class-abilities';
import { getAbilityCalcs, resetAbilityCalcRegistry } from '../ability-calcs';

const row = (over: Partial<AbilityConfigRow> & {
  slot: number; roleId: string; abilityId: string; label: string; mechanic: string;
  isDefault: boolean; abilityKey?: string; amount?: unknown;
}): AbilityConfigRow => ({
  class_key: 'wizard',
  unlock_level: over.slot === 1 ? 1 : 5,
  is_default: over.isDefault,
  status: 'active',
  ability_id: over.abilityId,
  role: { id: over.roleId, slot: over.slot, name: `Slot ${over.slot}` },
  ability: {
    ability_key: over.abilityKey ?? over.label.toLowerCase(),
    label: over.label,
    description: 'd',
    tooltip: 't',
    cp_cost: 10 * over.slot,
    mechanic_key: over.mechanic,
    status: 'active',
    amount_calc: over.amount ?? null,
    duration_calc: null,
    interval_ms: null,
    effect_config: {},
  },
});

const ROWS: AbilityConfigRow[] = [
  row({ slot: 1, roleId: 'r1', abilityId: 'a1', label: 'Fireball', mechanic: 'spell_attack', isDefault: true }),
  row({
    slot: 1, roleId: 'r1', abilityId: 'a2', label: 'Frost Bolt', mechanic: 'spell_attack',
    isDefault: false, abilityKey: 'frost_bolt',
    amount: { base: 3, terms: [{ stat: 'int', mult: 2 }] },
  }),
  row({ slot: 2, roleId: 'r2', abilityId: 'a3', label: 'Force Shield', mechanic: 'absorb_buff', isDefault: true }),
  // Unimplemented mechanic — must be dropped.
  row({ slot: 2, roleId: 'r2', abilityId: 'a4', label: 'Necro Ward', mechanic: 'not_a_mechanic', isDefault: false }),
];

describe('ability loadout options', () => {
  beforeEach(() => {
    resetAbilityRegistry();
    resetAbilityCalcRegistry();
    resetLoadoutOptions();
    setLoadoutOptions(ROWS);
  });

  it('groups active options per role, default first', () => {
    const roles = getLoadoutRoles('wizard');
    expect(roles.map(r => r.slot)).toEqual([1, 2]);
    expect(roles[0].options.map(o => o.ability.label)).toEqual(['Fireball', 'Frost Bolt']);
    expect(hasLoadoutOptions('wizard')).toBe(true);
  });

  it('drops options whose mechanic has no code handler', () => {
    const slot2 = getLoadoutRoles('wizard').find(r => r.slot === 2)!;
    expect(slot2.options.map(o => o.ability.label)).toEqual(['Force Shield']);
  });

  it('only reports roles that offer a real choice', () => {
    expect(getRolesWithAlternatives('wizard').map(r => r.roleId)).toEqual(['r1']);
  });

  it('applies a selection into the live bar and calc registry', () => {
    applyAbilityLoadout('wizard', { r1: 'a2' });
    expect(CLASS_ABILITIES.wizard.map(a => a.label)).toEqual(['Frost Bolt', 'Force Shield']);
    expect(CLASS_ABILITIES.wizard.map(a => a.tier)).toEqual([0, 1]);
    expect(getAbilityCalcs('wizard', 0)?.abilityKey).toBe('frost_bolt');
    expect(getAbilityCalcs('wizard', 0)?.amountCalc).toBeTruthy();
  });

  it('falls back to the class default for unselected or unknown roles', () => {
    applyAbilityLoadout('wizard', { r1: 'does-not-exist' });
    expect(CLASS_ABILITIES.wizard.map(a => a.label)).toEqual(['Fireball', 'Force Shield']);
  });

  it('leaves fallback lists untouched for classes with no options', () => {
    const before = CLASS_ABILITIES.warrior.map(a => a.label);
    applyAbilityLoadout('warrior', { r9: 'x' });
    expect(CLASS_ABILITIES.warrior.map(a => a.label)).toEqual(before);
  });
});
