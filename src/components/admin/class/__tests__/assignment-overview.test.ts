import { describe, expect, it } from 'vitest';
import {
  buildAssignmentOverview, type OverviewAssignment,
} from '../assignment-overview';

const classes = [
  { class_key: 'wizard', label: 'Wizard', sort_order: 2 },
  { class_key: 'warrior', label: 'Warrior', sort_order: 1 },
];
const roles = [
  { id: 'r1', class_key: 'wizard', slot: 1, name: 'Signature' },
  { id: 'r2', class_key: 'wizard', slot: 2, name: 'Utility' },
  { id: 'r3', class_key: 'warrior', slot: 1, name: 'Signature' },
];

const a = (o: Partial<OverviewAssignment>): OverviewAssignment => ({
  class_key: 'wizard', role_id: 'r1', status: 'active', is_default: true,
  ability_label: 'Fireball', ability_key: 'fireball', ...o,
});

describe('buildAssignmentOverview', () => {
  it('orders classes by sort_order and lists slots in slot order', () => {
    const rows = buildAssignmentOverview(classes, roles, []);
    expect(rows.map(r => r.classKey)).toEqual(['warrior', 'wizard']);
    expect(rows[1].slots.map(s => s.slot)).toEqual([1, 2]);
  });

  it('separates the default from alternatives', () => {
    const rows = buildAssignmentOverview(classes, roles, [
      a({}),
      a({ is_default: false, ability_label: 'Frost Bolt', ability_key: 'frost_bolt' }),
    ]);
    const slot = rows.find(r => r.classKey === 'wizard')!.slots[0];
    expect(slot.defaultLabel).toBe('Fireball');
    expect(slot.alternatives).toEqual(['Frost Bolt']);
    expect(slot.health).toBe('ok');
  });

  it('ignores non-active assignments as coverage', () => {
    const rows = buildAssignmentOverview(classes, roles, [a({ status: 'retired' })]);
    const slot = rows.find(r => r.classKey === 'wizard')!.slots[0];
    expect(slot.activeCount).toBe(0);
    expect(slot.health).toBe('empty');
  });

  it('flags missing and duplicated defaults', () => {
    const rows = buildAssignmentOverview(classes, roles, [
      a({ is_default: false }),
      a({ role_id: 'r2', ability_label: 'Blink', ability_key: 'blink' }),
      a({ role_id: 'r2', ability_label: 'Ward', ability_key: 'ward' }),
    ]);
    const wizard = rows.find(r => r.classKey === 'wizard')!;
    expect(wizard.slots[0].health).toBe('no_default');
    expect(wizard.slots[1].health).toBe('multi_default');
    expect(wizard.issues).toBe(2);
  });
});
