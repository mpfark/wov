/**
 * assignment-overview — pure shaping for the read-only cross-class assignment
 * overview (the former AssignmentMatrix, now class-scoped and read-only).
 *
 * It only reads: no writes, no defaults invented. Editing always happens in the
 * per-class assignment editor, so this stays a reporting surface that makes gaps
 * (empty slot, missing default, extra defaults, retired-only slot) obvious.
 */

export interface OverviewClass { class_key: string; label: string; sort_order?: number }
export interface OverviewRole { id: string; class_key: string; slot: number; name: string }
export interface OverviewAssignment {
  class_key: string;
  role_id: string;
  status: string;
  is_default: boolean;
  ability_label: string;
  ability_key: string;
}

export type SlotHealth = 'ok' | 'empty' | 'no_default' | 'multi_default';

export interface OverviewSlot {
  roleId: string;
  slot: number;
  name: string;
  defaultLabel: string | null;
  alternatives: string[];
  /** Active assignments only — retired/draft rows never count as coverage. */
  activeCount: number;
  health: SlotHealth;
}

export interface OverviewRow {
  classKey: string;
  label: string;
  slots: OverviewSlot[];
  issues: number;
}

export function buildAssignmentOverview(
  classes: OverviewClass[],
  roles: OverviewRole[],
  assignments: OverviewAssignment[],
): OverviewRow[] {
  return classes
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.label.localeCompare(b.label))
    .map(cls => {
      const classRoles = roles
        .filter(r => r.class_key === cls.class_key)
        .slice()
        .sort((a, b) => a.slot - b.slot);

      const slots: OverviewSlot[] = classRoles.map(role => {
        const active = assignments.filter(
          a => a.role_id === role.id && a.class_key === cls.class_key && a.status === 'active',
        );
        const defaults = active.filter(a => a.is_default);
        const health: SlotHealth = active.length === 0
          ? 'empty'
          : defaults.length === 0
            ? 'no_default'
            : defaults.length > 1 ? 'multi_default' : 'ok';

        return {
          roleId: role.id,
          slot: role.slot,
          name: role.name,
          defaultLabel: defaults[0]?.ability_label ?? null,
          alternatives: active.filter(a => !a.is_default).map(a => a.ability_label).sort(),
          activeCount: active.length,
          health,
        };
      });

      return {
        classKey: cls.class_key,
        label: cls.label,
        slots,
        issues: slots.filter(s => s.health !== 'ok').length,
      };
    });
}
