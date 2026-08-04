/**
 * assignment-guard — pure rules that keep class ability assignments coherent.
 *
 * Phase 2 of the ability-ownership correction. Class Config is the sole owner of
 * `class_ability_assignments`, so it is also the only place that can break a
 * player's equipped loadout. These rules are pure so they can be unit-tested
 * without a database and reused by any future server-side enforcement.
 */

export interface RemoveCheckInput {
  /** True when this assignment is the slot default. */
  isDefault: boolean;
  /** Other assignments left in the same slot after removal. */
  siblingCount: number;
  /** Characters that currently have THIS assignment equipped in the slot. */
  equippedCount: number;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

export function canRemoveAssignment(input: RemoveCheckInput): GuardResult {
  if (input.equippedCount > 0) {
    return {
      ok: false,
      reason: `${input.equippedCount} character loadout${input.equippedCount === 1 ? '' : 's'} `
        + 'still equip this ability — clear or migrate those loadouts first.',
    };
  }
  if (input.isDefault && input.siblingCount > 0) {
    return {
      ok: false,
      reason: 'This is the slot default. Promote another assignment to default before removing it.',
    };
  }
  return { ok: true };
}

export interface SlotDefaultRow {
  role_id: string;
  is_default: boolean;
}

/** Slots that violate the exactly-one-default rule (ignores empty slots). */
export function slotsWithBadDefaults(rows: SlotDefaultRow[]): { role_id: string; defaults: number }[] {
  const counts = new Map<string, { total: number; defaults: number }>();
  for (const row of rows) {
    const entry = counts.get(row.role_id) ?? { total: 0, defaults: 0 };
    entry.total += 1;
    if (row.is_default) entry.defaults += 1;
    counts.set(row.role_id, entry);
  }
  return [...counts.entries()]
    .filter(([, v]) => v.total > 0 && v.defaults !== 1)
    .map(([role_id, v]) => ({ role_id, defaults: v.defaults }));
}
