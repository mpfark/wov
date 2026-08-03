/**
 * classes.ts — Class configuration used by combat & resource math.
 *
 * CANONICAL OWNER for: CLASS_BASE_HP, CLASS_BASE_AC, CLASS_CRIT_RANGE,
 * CLASS_LEVEL_BONUSES, CLASS_LABELS, CLASS_WEAPON_AFFINITY,
 * weapon/shield mechanics constants.
 *
 * Autoattacks are entirely weapon-driven (DEX to-hit, STR damage) — there is
 * no per-class autoattack profile. Class identity lives in abilities.
 *
 * Phase 2 (configurable classes): the tables below are now *fallback
 * defaults* only. At runtime `setClassRegistry()` is called with the rows of
 * the `classes` table (client: on app boot; edge functions: per invocation)
 * and mutates these records in place, so every existing consumer reads the
 * configured values without changing its import.
 *
 * The mechanical constants that are NOT per-class (affinity bonus size,
 * shield AC, off-hand multiplier) stay code-owned on purpose.
 *
 * NOTE: Race/class descriptions and stat tables (RACE_STATS, CLASS_STATS,
 * RACE_LABELS, RACE_DESCRIPTIONS, CLASS_DESCRIPTIONS, STAT_LABELS) live in
 * `src/lib/game-data.ts` because they are UI-only and not needed by the
 * server combat path.
 */

export const CLASS_BASE_HP: Record<string, number> = {
  warrior: 24, wizard: 16, ranger: 20, assassin: 16, healer: 18, bard: 16, templar: 22,
  classless: 18,
};

export const CLASS_BASE_AC: Record<string, number> = {
  warrior: 12, wizard: 9, ranger: 10, assassin: 10, healer: 9, bard: 9, templar: 12,
  classless: 10,
};

/** Class-based stat bonuses awarded every 3 levels */
export const CLASS_LEVEL_BONUSES: Record<string, Record<string, number>> = {
  warrior: { str: 1, dex: 1 },
  wizard:  { int: 1, wis: 1 },
  ranger:  { dex: 1, wis: 1 },
  assassin:   { dex: 1, cha: 1 },
  healer:  { wis: 1, con: 1 },
  bard:    { cha: 1, int: 1 },
  templar: { wis: 1, con: 1 },
  classless: {},
};

export const CLASS_LABELS: Record<string, string> = {
  warrior: 'Warrior', wizard: 'Wizard', ranger: 'Ranger',
  assassin: 'Assassin', healer: 'Healer', bard: 'Bard', templar: 'Templar',
  classless: 'Wayfarer',
};

export const CLASS_WEAPON_AFFINITY: Record<string, string[]> = {
  warrior: ['sword', 'axe', 'mace'],
  ranger:  ['bow', 'dagger'],
  assassin:   ['dagger', 'sword'],
  wizard:  ['staff', 'wand'],
  healer:  ['mace', 'staff'],
  bard:    ['sword', 'wand'],
  templar: ['sword', 'mace'],
};

/**
 * Per-class natural-d20 crit threshold. A roll >= this number crits before
 * DEX/buff reductions are applied. Most classes crit on natural 20; assassin
 * keeps a slightly wider crit range (19-20) as a class identity perk.
 */
export const CLASS_CRIT_RANGE: Record<string, number> = {
  warrior: 20, wizard: 20, ranger: 20, assassin: 19, healer: 20, bard: 20, templar: 20,
};

// ── Runtime registry (rows of the `classes` table) ───────────────

/** Shape of a `classes` row, as far as gameplay math cares. */
/**
 * Per-class scaling attributes. `primary` is the class's defining attribute and
 * `secondary` its support attribute; they tag the calc terms an ability
 * assignment may retarget through `overrides.scaling`.
 */
export const CLASS_SCALING: Record<string, { primary: string; secondary: string | null }> = {
  warrior: { primary: 'str', secondary: 'dex' },
  wizard: { primary: 'int', secondary: null },
  ranger: { primary: 'dex', secondary: 'wis' },
  assassin: { primary: 'dex', secondary: 'cha' },
  healer: { primary: 'wis', secondary: 'con' },
  bard: { primary: 'cha', secondary: 'int' },
  templar: { primary: 'wis', secondary: 'con' },
};

export function getClassScaling(classKey: string): { primary: string | null; secondary: string | null } {
  const row = CLASS_SCALING[classKey];
  return { primary: row?.primary ?? null, secondary: row?.secondary ?? null };
}

export interface ClassConfigRow {
  class_key: string;
  label?: string | null;
  base_hp?: number | null;
  base_ac?: number | null;
  crit_range?: number | null;
  level_bonuses?: Record<string, number> | null;
  weapon_proficiencies?: string[] | null;
  is_pre_class?: boolean | null;
  is_selectable?: boolean | null;
  sort_order?: number | null;
  status?: string | null;
  primary_attribute?: string | null;
  secondary_attribute?: string | null;
}

let registryLoaded = false;
const registryMeta: Record<string, { isPreClass: boolean; isSelectable: boolean; sortOrder: number; status: string }> = {};

/** True once `setClassRegistry` has been fed at least one row. */
export function isClassRegistryLoaded(): boolean {
  return registryLoaded;
}

/**
 * Apply configured class rows over the fallback tables. Mutates the exported
 * records in place so every consumer (including modules that captured a
 * reference at import time) observes the configured values.
 */
export function setClassRegistry(rows: ClassConfigRow[]): void {
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    const key = row.class_key;
    if (!key) continue;
    if (row.label) CLASS_LABELS[key] = row.label;
    if (typeof row.base_hp === 'number') CLASS_BASE_HP[key] = row.base_hp;
    if (typeof row.base_ac === 'number') CLASS_BASE_AC[key] = row.base_ac;
    if (typeof row.crit_range === 'number') CLASS_CRIT_RANGE[key] = row.crit_range;
    if (row.level_bonuses) CLASS_LEVEL_BONUSES[key] = { ...row.level_bonuses };
    if (row.weapon_proficiencies && row.weapon_proficiencies.length > 0) {
      CLASS_WEAPON_AFFINITY[key] = [...row.weapon_proficiencies];
    }
    if (row.primary_attribute) {
      CLASS_SCALING[key] = {
        primary: row.primary_attribute,
        secondary: row.secondary_attribute ?? null,
      };
    }
    registryMeta[key] = {
      isPreClass: !!row.is_pre_class,
      isSelectable: !!row.is_selectable,
      sortOrder: row.sort_order ?? 0,
      status: row.status ?? 'active',
    };
  }
  registryLoaded = true;
}

/** Class keys a player can actually belong to, excluding the Wayfarer row. */
export function getPlayableClassKeys(): string[] {
  const keys = Object.keys(CLASS_LABELS).filter(k => !isPreClass(k));
  if (!registryLoaded) return keys;
  return keys.sort((a, b) => (registryMeta[a]?.sortOrder ?? 0) - (registryMeta[b]?.sortOrder ?? 0));
}

/** Class keys offered in a class hall (selectable, published, not pre-class). */
export function getSelectableClassKeys(): string[] {
  if (!registryLoaded) return getPlayableClassKeys();
  return getPlayableClassKeys().filter(k => registryMeta[k]?.isSelectable !== false && registryMeta[k]?.status === 'active');
}

export function isPreClass(classKey: string): boolean {
  if (registryLoaded && registryMeta[classKey]) return registryMeta[classKey].isPreClass;
  return classKey === 'classless';
}

// ── Accessors (prefer these in new code) ────────────────────────

export function getClassLabel(classKey: string): string {
  return CLASS_LABELS[classKey] ?? classKey;
}

export function getClassBaseHp(classKey: string): number {
  return CLASS_BASE_HP[classKey] ?? 18;
}

export function getClassBaseAc(classKey: string): number {
  return CLASS_BASE_AC[classKey] ?? 10;
}

export function getClassLevelBonuses(classKey: string): Record<string, number> {
  return CLASS_LEVEL_BONUSES[classKey] ?? {};
}

export function getClassCritRange(classKey: string): number {
  return CLASS_CRIT_RANGE[classKey] ?? 20;
}

export function getClassWeaponAffinity(classKey: string): string[] {
  return CLASS_WEAPON_AFFINITY[classKey] ?? [];
}

// ── Mechanical constants (not per-class, stay code-owned) ────────

/** Weapon tags that grant an off-hand bonus attack (shields do NOT) */
export const OFFHAND_WEAPON_TAGS = ['sword', 'axe', 'mace', 'dagger', 'bow', 'staff', 'wand'];
/** Off-hand damage multiplier (30% of main-hand base damage) */
export const OFFHAND_DAMAGE_MULT = 0.30;

export const SHIELD_AC_BONUS = 1;
/** Shield grants +5% anti-crit on top of WIS-based anti-crit */
export const SHIELD_ANTI_CRIT_BONUS = 0.05;

export function isShield(tag?: string | null): boolean {
  return tag === 'shield';
}

/** Returns hit bonus and damage multiplier when class matches weapon tag */
export function getWeaponAffinityBonus(
  classKey: string,
  weaponTag?: string | null,
): { hitBonus: number; damageMult: number } {
  if (!weaponTag) return { hitBonus: 0, damageMult: 1 };
  const tags = CLASS_WEAPON_AFFINITY[classKey];
  if (tags && tags.includes(weaponTag)) return { hitBonus: 1, damageMult: 1.10 };
  return { hitBonus: 0, damageMult: 1 };
}

/** Check whether the off-hand item is a weapon (not a shield) and thus grants a bonus attack */
export function isOffhandWeapon(offhandTag?: string | null): boolean {
  return !!offhandTag && OFFHAND_WEAPON_TAGS.includes(offhandTag);
}
