/**
 * class-validate.ts — Phase 3: validation for configurable class rows.
 *
 * Pure, dependency-free checks shared by the admin editor (and usable by
 * server code) so a class row can never be published with values that would
 * break combat or resource math. Errors block a save/publish; warnings are
 * balance smells that an admin may knowingly accept.
 */

export const CLASS_STAT_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type ClassStatKey = typeof CLASS_STAT_KEYS[number];

/** Weapon tags a class may be proficient with (mirrors `items.weapon_tag`). */
export const WEAPON_TAGS = ['sword', 'axe', 'mace', 'dagger', 'bow', 'staff', 'wand', 'shield'] as const;

export type ClassStatus = 'draft' | 'active' | 'retired';
export const CLASS_STATUSES: ClassStatus[] = ['draft', 'active', 'retired'];

export interface ClassConfigDraft {
  class_key: string;
  label: string;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
  status: string;
  is_pre_class: boolean;
  is_selectable: boolean;
  sort_order: number;
  base_hp: number;
  base_ac: number;
  crit_range: number;
  level_bonuses: Record<string, number>;
  weapon_proficiencies: string[];
}

export interface ClassValidation {
  errors: string[];
  warnings: string[];
}

/** Bounds kept deliberately wide — they catch typos, not design choices. */
export const CLASS_BOUNDS = {
  baseHp: [10, 40] as const,
  baseAc: [6, 16] as const,
  critRange: [17, 20] as const,
  levelBonusTotal: 2,
};

export function validateClassConfig(draft: ClassConfigDraft): ClassValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const preClass = !!draft.is_pre_class;

  if (!/^[a-z][a-z0-9_]*$/.test(draft.class_key || '')) {
    errors.push('Class key must be lowercase letters, digits and underscores.');
  }
  if (!draft.label?.trim()) errors.push('Label is required.');
  if (!CLASS_STATUSES.includes(draft.status as ClassStatus)) {
    errors.push(`Status must be one of ${CLASS_STATUSES.join(', ')}.`);
  }

  const [hpMin, hpMax] = CLASS_BOUNDS.baseHp;
  if (!Number.isFinite(draft.base_hp) || draft.base_hp < hpMin || draft.base_hp > hpMax) {
    errors.push(`Base HP must be between ${hpMin} and ${hpMax}.`);
  }
  const [acMin, acMax] = CLASS_BOUNDS.baseAc;
  if (!Number.isFinite(draft.base_ac) || draft.base_ac < acMin || draft.base_ac > acMax) {
    errors.push(`Base AC must be between ${acMin} and ${acMax}.`);
  }
  const [crMin, crMax] = CLASS_BOUNDS.critRange;
  if (!Number.isInteger(draft.crit_range) || draft.crit_range < crMin || draft.crit_range > crMax) {
    errors.push(`Crit range must be an integer between ${crMin} and ${crMax}.`);
  }
  if (!Number.isInteger(draft.sort_order) || draft.sort_order < 0) {
    errors.push('Sort order must be a non-negative integer.');
  }

  // Level bonuses (awarded every 3 levels)
  const bonusEntries = Object.entries(draft.level_bonuses ?? {}).filter(([, v]) => Number(v) !== 0);
  let bonusTotal = 0;
  for (const [stat, value] of bonusEntries) {
    if (!CLASS_STAT_KEYS.includes(stat as ClassStatKey)) {
      errors.push(`Unknown level-bonus stat "${stat}".`);
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value > 2) {
      errors.push(`Level bonus for ${stat.toUpperCase()} must be an integer 0-2.`);
      continue;
    }
    bonusTotal += value;
  }
  if (!preClass && bonusTotal !== CLASS_BOUNDS.levelBonusTotal) {
    warnings.push(
      `Level bonuses total ${bonusTotal} — every other class grants ${CLASS_BOUNDS.levelBonusTotal} points per 3 levels.`,
    );
  }

  // Weapon proficiencies
  const profs = draft.weapon_proficiencies ?? [];
  for (const tag of profs) {
    if (!WEAPON_TAGS.includes(tag as typeof WEAPON_TAGS[number])) {
      errors.push(`Unknown weapon tag "${tag}".`);
    }
  }
  if (new Set(profs).size !== profs.length) errors.push('Duplicate weapon proficiency.');
  if (!preClass && profs.length === 0) {
    warnings.push('No weapon proficiencies — this class never gets the affinity hit/damage bonus.');
  }

  if (preClass && draft.is_selectable) {
    errors.push('A pre-class (Wayfarer) row cannot be selectable in a class hall.');
  }

  return { errors, warnings };
}

/**
 * Lifecycle guard: can this status/selectable transition be applied?
 *
 * `liveCharacters` is the number of existing characters on the class and
 * `abilityGaps` the number of ability roles with no published assignment.
 */
export function validateClassLifecycle(opts: {
  nextStatus: string;
  nextSelectable: boolean;
  isPreClass: boolean;
  liveCharacters: number;
  abilityGaps: number;
}): ClassValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { nextStatus, nextSelectable, isPreClass, liveCharacters, abilityGaps } = opts;

  if (nextStatus === 'retired' && liveCharacters > 0) {
    errors.push(
      `${liveCharacters} character(s) still belong to this class — reassign them before retiring it.`,
    );
  }
  if (nextStatus !== 'active' && nextSelectable) {
    errors.push('Only an active class can be selectable in a class hall.');
  }
  if (nextStatus === 'active' && !isPreClass && abilityGaps > 0) {
    warnings.push(`${abilityGaps} ability slot(s) have no published ability — players will see an empty bar slot.`);
  }
  if (nextStatus === 'draft' && liveCharacters > 0) {
    warnings.push(`${liveCharacters} character(s) already play this class while it is a draft.`);
  }
  return { errors, warnings };
}
