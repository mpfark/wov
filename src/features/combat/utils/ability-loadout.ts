/**
 * ability-loadout.ts — Phase 4: alternative abilities + per-character loadouts.
 *
 * Phase 2b/2c made the *default* ability per role configurable. This module adds
 * the non-default rows: every active `class_ability_assignments` row for a role
 * becomes a selectable option, and a character's chosen option (stored in
 * `character_ability_loadout`) replaces the default in that bar slot.
 *
 * Presentation and magnitudes are applied through the existing registries, so
 * consumers (ability bar, combat driver, tooltips, calc resolvers) need no
 * change: `applyAbilityLoadout` rewrites `CLASS_ABILITIES[classKey]` and the
 * matching `ABILITY_CALCS` entries in place.
 *
 * Mechanics stay code-owned: an option whose `mechanic_key` has no handler is
 * dropped, exactly as in `setAbilityRegistry`.
 */
import {
  isKnownAbilityMechanic, setClassAbilityList,
  type AbilityConfigRow, type ClassAbility,
} from './class-abilities';
import { setAbilityCalcEntry, toAbilityCalcEntry, type AbilityCalcEntry } from './ability-calcs';

export interface LoadoutOption {
  /** `abilities.id` — the value stored in `character_ability_loadout.ability_id`. */
  abilityId: string;
  abilityKey: string;
  /** Canonical damage type key (null for buffs, heals and utility). */
  damageType: string | null;
  /** True for the class default (the row flagged `is_default`). */
  isDefault: boolean;
  ability: ClassAbility;
  calc: AbilityCalcEntry;
}

export interface LoadoutRole {
  /** `class_ability_roles.id` — the loadout key. */
  roleId: string;
  /** 1-based config slot; the runtime bar tier is its 0-based index. */
  slot: number;
  name: string;
  unlockLevel: number;
  options: LoadoutOption[];
}

/** class_key -> roles (sorted by slot), each carrying its selectable options. */
const ROLE_OPTIONS: Record<string, LoadoutRole[]> = {};

/** Rows must carry role id/name and ability id/key for loadouts to be usable. */
export function setLoadoutOptions(rows: AbilityConfigRow[]): void {
  if (!rows || rows.length === 0) return;
  for (const key of Object.keys(ROLE_OPTIONS)) delete ROLE_OPTIONS[key];

  for (const row of rows) {
    if (!row.ability || !row.role) continue;
    if (row.status !== 'active' || row.ability.status !== 'active') continue;
    const roleId = row.role.id;
    const abilityId = row.ability_id;
    if (!roleId || !abilityId) continue;
    if (!isKnownAbilityMechanic(row.ability.mechanic_key)) continue;

    const roles = ROLE_OPTIONS[row.class_key] ?? [];
    let role = roles.find(r => r.roleId === roleId);
    if (!role) {
      role = {
        roleId,
        slot: row.role.slot,
        name: row.role.name ?? `Slot ${row.role.slot}`,
        unlockLevel: row.unlock_level,
        options: [],
      };
      roles.push(role);
    }
    if (row.is_default) role.unlockLevel = row.unlock_level;
    role.options.push({
      abilityId,
      abilityKey: row.ability.ability_key ?? '',
      damageType: row.ability.damage_type ?? null,
      isDefault: row.is_default,
      ability: {
        label: row.ability.label,
        description: row.ability.description,
        tooltip: row.ability.tooltip,
        cpCost: row.ability.cp_cost,
        type: row.ability.mechanic_key as ClassAbility['type'],
        tier: row.role.slot, // normalized when the list is applied
        levelRequired: row.unlock_level,
      },
      calc: toAbilityCalcEntry(row),
    });
    ROLE_OPTIONS[row.class_key] = roles;
  }

  for (const roles of Object.values(ROLE_OPTIONS)) {
    roles.sort((a, b) => a.slot - b.slot);
    for (const role of roles) {
      role.options.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    }
  }
}

/** Every role of `classKey` with its selectable options (empty when unloaded). */
export function getLoadoutRoles(classKey: string): LoadoutRole[] {
  return ROLE_OPTIONS[classKey] ?? [];
}

/** Roles that actually offer a choice (more than one active option). */
export function getRolesWithAlternatives(classKey: string): LoadoutRole[] {
  return getLoadoutRoles(classKey).filter(r => r.options.length > 1);
}

/** True once alternative options have been loaded for `classKey`. */
export function hasLoadoutOptions(classKey: string): boolean {
  return (ROLE_OPTIONS[classKey]?.length ?? 0) > 0;
}

/**
 * Resolve `selections` (role_id -> ability_id) into the live bar for `classKey`.
 * Unselected roles keep their default option; unknown ability ids are ignored.
 * No-ops when the class has no loaded options, so a failed config load leaves
 * the fallback lists untouched.
 */
export function applyAbilityLoadout(
  classKey: string,
  selections: Record<string, string>,
): void {
  const roles = getLoadoutRoles(classKey);
  if (roles.length === 0) return;

  const chosen: LoadoutOption[] = [];
  for (const role of roles) {
    const selectedId = selections[role.roleId];
    const option =
      (selectedId && role.options.find(o => o.abilityId === selectedId))
      || role.options.find(o => o.isDefault)
      || role.options[0];
    if (option) chosen.push(option);
  }
  if (chosen.length === 0) return;

  setClassAbilityList(classKey, chosen.map(o => ({ ...o.ability })));
  chosen.forEach((option, tier) => setAbilityCalcEntry(classKey, tier, option.calc));
}

/** Clear loaded options (tests / class switches). */
export function resetLoadoutOptions(): void {
  for (const key of Object.keys(ROLE_OPTIONS)) delete ROLE_OPTIONS[key];
}
