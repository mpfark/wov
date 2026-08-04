/**
 * assignment-guard.test.ts — Phase 2 contract: Class Config owns assignments and
 * may not silently invalidate an equipped loadout or leave a slot without
 * exactly one default.
 */
import { describe, it, expect } from 'vitest';
import { canRemoveAssignment, slotsWithBadDefaults } from '../assignment-guard';

describe('canRemoveAssignment', () => {
  it('blocks removal while characters equip the ability', () => {
    const res = canRemoveAssignment({ isDefault: false, siblingCount: 1, equippedCount: 3 });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('3 character loadouts');
  });

  it('blocks removing the default while alternatives remain', () => {
    const res = canRemoveAssignment({ isDefault: true, siblingCount: 2, equippedCount: 0 });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('Promote another assignment');
  });

  it('allows emptying a slot entirely', () => {
    expect(canRemoveAssignment({ isDefault: true, siblingCount: 0, equippedCount: 0 }).ok).toBe(true);
  });

  it('allows removing an unused alternative', () => {
    expect(canRemoveAssignment({ isDefault: false, siblingCount: 1, equippedCount: 0 }).ok).toBe(true);
  });
});

describe('slotsWithBadDefaults', () => {
  it('reports slots with no default and slots with two', () => {
    const bad = slotsWithBadDefaults([
      { role_id: 'a', is_default: true },
      { role_id: 'a', is_default: false },
      { role_id: 'b', is_default: false },
      { role_id: 'c', is_default: true },
      { role_id: 'c', is_default: true },
    ]);
    expect(bad).toEqual([
      { role_id: 'b', defaults: 0 },
      { role_id: 'c', defaults: 2 },
    ]);
  });

  it('ignores empty slots', () => {
    expect(slotsWithBadDefaults([])).toEqual([]);
  });
});
