/**
 * class-authoring.ts — Phase 4: pure helpers for authoring new classes and
 * abilities through the admin UI.
 *
 * A new class is only ever created as a `draft`: it gets the canonical five
 * ability roles (Signature → Mastery) so the ability editor has slots to fill,
 * and it stays out of class halls until an admin publishes it.
 */

export interface RoleTemplate {
  slot: number;
  name: string;
  description: string;
  unlock_level: number;
}

/** Canonical role ladder shared by every class. */
export const CLASS_ROLE_TEMPLATE: RoleTemplate[] = [
  { slot: 1, name: 'Signature', description: 'Class identity attack, available from level 1.', unlock_level: 1 },
  { slot: 2, name: 'Discipline', description: 'Early sustain, stance or utility tool.', unlock_level: 5 },
  { slot: 3, name: 'Doctrine', description: 'Mid-tier stance or control tool.', unlock_level: 10 },
  { slot: 4, name: 'Pressure', description: 'Sustained damage, healing or control over time.', unlock_level: 15 },
  { slot: 5, name: 'Mastery', description: 'Capstone ability unlocked at level 20.', unlock_level: 20 },
];

/** Neutral baseline a newly authored class starts from (tunable afterwards). */
export const NEW_CLASS_DEFAULTS = {
  base_hp: 18,
  base_ac: 10,
  crit_range: 20,
  level_bonuses: {} as Record<string, number>,
  weapon_proficiencies: [] as string[],
};

export function validateNewClassKey(key: string, existing: string[]): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(key)) {
    errors.push('Key must be 3-24 lowercase letters, digits or underscores and start with a letter.');
  }
  if (existing.includes(key)) errors.push(`Class key "${key}" already exists.`);
  return errors;
}

export interface NewAbilityDraft {
  ability_key: string;
  label: string;
  emoji: string;
  description: string;
  tooltip: string;
  mechanic_key: string;
  cp_cost: number;
  unlock_level: number;
}

export function validateNewAbility(
  draft: NewAbilityDraft,
  opts: { existingKeys: string[]; knownMechanics: string[] },
): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_]{2,39}$/.test(draft.ability_key)) {
    errors.push('Ability key must be 3-40 lowercase letters, digits or underscores.');
  }
  if (opts.existingKeys.includes(draft.ability_key)) {
    errors.push(`Ability key "${draft.ability_key}" already exists.`);
  }
  if (!draft.label.trim()) errors.push('Label is required.');
  if (!draft.description.trim()) errors.push('Description is required.');
  if (!opts.knownMechanics.includes(draft.mechanic_key)) {
    errors.push('Pick a mechanic that has a code handler — new mechanics need a code change.');
  }
  if (!Number.isInteger(draft.cp_cost) || draft.cp_cost < 0 || draft.cp_cost > 100) {
    errors.push('CP cost must be an integer between 0 and 100.');
  }
  if (!Number.isInteger(draft.unlock_level) || draft.unlock_level < 1 || draft.unlock_level > 42) {
    errors.push('Unlock level must be between 1 and 42.');
  }
  return errors;
}

/** Suggest a snake_case ability key from a label. */
export function suggestAbilityKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
