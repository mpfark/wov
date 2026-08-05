/**
 * class-config-layout.test.tsx — guards the Class Config page arrangement:
 * a class page shows ONLY that class (no cross-class assignment overview), the
 * class-wide configuration comes before the ability workflow in DOM order (so
 * narrow widths stack correctly), the wide-screen layout is a two-column grid,
 * and the selected class exposes exactly its five slots with one editor open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

const CLASSES = [
  { class_key: 'warrior', label: 'Warrior', color: '', description: '', status: 'active', is_pre_class: false, is_selectable: true, sort_order: 1, base_hp: 20, base_ac: 10, crit_range: 20, level_bonuses: {}, weapon_proficiencies: [], primary_attribute: 'str', secondary_attribute: 'dex' },
  { class_key: 'wizard', label: 'Wizard', color: '', description: '', status: 'active', is_pre_class: false, is_selectable: true, sort_order: 2, base_hp: 14, base_ac: 10, crit_range: 20, level_bonuses: {}, weapon_proficiencies: [], primary_attribute: 'int', secondary_attribute: 'wis' },
];

const ROLES = [1, 2, 3, 4, 5].flatMap(slot => ([
  { id: `warrior-${slot}`, class_key: 'warrior', slot, name: `Warrior slot ${slot}`, unlock_level: slot },
  { id: `wizard-${slot}`, class_key: 'wizard', slot, name: `Wizard slot ${slot}`, unlock_level: slot },
]));

const base = (key: string, label: string) => ({
  id: `base-${key}`, ability_key: key, label, description: '', tooltip: '',
  mechanic_key: 'power_strike', status: 'active', cp_cost: 10, damage_type: 'physical',
  amount_calc: { version: 2, base: 1, terms: [], unit: 'damage' }, duration_calc: null,
  interval_ms: null, mechanic_calcs: {}, combat_text: {},
});

const ASSIGNMENTS = [
  { id: 'a-w1', class_key: 'warrior', role_id: 'warrior-1', unlock_level: 1, status: 'active', is_default: true, overrides: {}, role: { id: 'warrior-1', slot: 1, name: 'Warrior slot 1' }, ability: base('power_strike', 'Power Strike') },
  { id: 'a-w2', class_key: 'warrior', role_id: 'warrior-1', unlock_level: 1, status: 'active', is_default: false, overrides: {}, role: { id: 'warrior-1', slot: 1, name: 'Warrior slot 1' }, ability: base('cleave', 'Cleave') },
  { id: 'a-z1', class_key: 'wizard', role_id: 'wizard-1', unlock_level: 1, status: 'active', is_default: true, overrides: {}, role: { id: 'wizard-1', slot: 1, name: 'Wizard slot 1' }, ability: base('fireball', 'Fireball') },
];

/** Minimal chainable Supabase stub: resolves per table, ignores filters. */
function tableData(table: string) {
  switch (table) {
    case 'classes': return CLASSES;
    case 'class_ability_roles': return ROLES;
    case 'class_ability_assignments': return ASSIGNMENTS;
    case 'characters': return [{ class: 'warrior' }];
    case 'character_ability_loadout': return [];
    case 'abilities': return [base('power_strike', 'Power Strike')];
    default: return [];
  }
}

vi.mock('@/integrations/supabase/client', () => {
  const builder = (table: string) => {
    const filters: [string, unknown][] = [];
    const resolve = () => ({
      data: tableData(table).filter((row: Record<string, unknown>) =>
        filters.every(([column, value]) => row[column] === value)),
      error: null,
    });
    const chain: Record<string, unknown> = {
      then: (fn: (r: unknown) => unknown) => Promise.resolve(resolve()).then(fn),
      eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
    };
    for (const method of ['select', 'in', 'order', 'neq', 'limit']) {
      chain[method] = () => chain;
    }
    return chain;
  };
  return { supabase: { from: (table: string) => builder(table) } };
});


import ClassConfigManager from '@/components/admin/ClassConfigManager';

async function selectWarrior() {
  render(<ClassConfigManager />);
  const button = await screen.findByRole('button', { name: /Warrior/ });
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByText('Ability configuration')).toBeInTheDocument());
}

beforeEach(() => vi.clearAllMocks());

describe('Class Config page layout', () => {
  it('uses a two-column grid on wide screens with class config left and abilities right', async () => {
    await selectWarrior();

    const grid = document.querySelector('.xl\\:grid-cols-12') as HTMLElement;
    expect(grid).toBeTruthy();

    const [left, right] = Array.from(grid.children) as HTMLElement[];
    expect(left.className).toContain('xl:col-span-5');
    expect(right.className).toContain('xl:col-span-7');
    expect(within(left).getByText('Combat baseline')).toBeInTheDocument();
    expect(within(right).getByText('Ability configuration')).toBeInTheDocument();
    expect(within(left).queryByText('Ability configuration')).toBeNull();
  });

  it('stacks class-wide configuration before the ability workflow (narrow layout order)', async () => {
    await selectWarrior();

    const grid = document.querySelector('.xl\\:grid-cols-12') as HTMLElement;
    // Single column by default; the two-column rule is xl-only.
    expect(grid.className).toContain('grid-cols-1');

    const baseline = screen.getByText('Combat baseline');
    const abilities = screen.getByText('Ability configuration');
    expect(baseline.compareDocumentPosition(abilities))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows exactly five slots, all belonging to the selected class', async () => {
    await selectWarrior();

    const slotLabels = screen.getAllByText(/^Slot \d · /);
    expect(slotLabels).toHaveLength(5);
    for (const label of slotLabels) {
      expect(label.textContent).toContain('Warrior slot');
      expect(label.textContent).not.toContain('Wizard');
    }
  });

  it('renders no all-classes assignment overview on an individual class page', async () => {
    await selectWarrior();

    expect(screen.queryByText('Assignment overview')).toBeNull();
    // No other class's assignment row leaks into the page.
    expect(screen.queryByText('Fireball')).toBeNull();
  });

  it('keeps only one assignment editor expanded at a time', async () => {
    await selectWarrior();

    fireEvent.click(screen.getByRole('button', { name: /Power Strike/ }));
    await waitFor(() => expect(screen.getByText('Unlock level')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Cleave/ }));
    await waitFor(() => expect(screen.getAllByText('Unlock level')).toHaveLength(1));
  });
});
