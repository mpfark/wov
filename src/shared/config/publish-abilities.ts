/** Canonical publication boundary: use the browser's composition/override rules. */
import { composeAbilityRow, indexAppliedStatuses } from './compose-ability';
import { applyAssignmentOverrides } from './effective-ability';
import { getClassScaling } from '../formulas/classes';
import { buildAbilityCatalog } from '../combat2/catalog';

export interface AbilityPublicationSource {
  provenance: string;
  assignments: any[];
  statuses: any[];
  classes?: { class_key: string; primary_attribute?: string; secondary_attribute?: string }[];
}

export function publishAbilities(source: AbilityPublicationSource) {
  const statuses = [...source.statuses].sort((a, b) => a.key.localeCompare(b.key));
  const index = indexAppliedStatuses(statuses);
  const active = source.assignments.filter(row => row.status === 'active' && row.ability?.status === 'active');
  for (const row of active) {
    if (!row.ability.base || !row.role) throw new Error(`Missing base/role: ${row.class_ability_key}`);
    if (!Number.isFinite(row.unlock_level) || row.unlock_level < 1) throw new Error('Invalid unlock level');
    if (!Number.isFinite(row.ability.base.cp_cost) || row.ability.base.cp_cost < 0) throw new Error('Invalid CP cost');
  }
  const composed = active.map(row => ({ ...row, ability: {
    ...row.ability, ...composeAbilityRow(row.ability, row.ability.base, index),
  } }));
  const resolved = applyAssignmentOverrides(composed, key => {
    const configured = source.classes?.find(row => row.class_key === key);
    return configured ? { primary: configured.primary_attribute ?? null,
      secondary: configured.secondary_attribute ?? null } as any : getClassScaling(key) as any;
  });
  // Publishing invalid overrides must be explicit; never silently publish a fallback.
  if (resolved.errors.length) throw new Error(resolved.errors.join('\n'));
  const abilities = resolved.rows.map(row => {
    const a = row.ability;
    return {
      classKey: row.class_key, classAbilityKey: row.class_ability_key ?? a.ability_key,
      abilityKey: a.ability_key, label: a.label, description: a.description, tooltip: a.tooltip,
      unlockLevel: row.unlock_level, isDefault: row.is_default === true,
      roleSlot: row.role?.slot ?? null, roleName: row.role?.name ?? null,
      baseKey: a.base_key, mechanic: a.mechanic_key, abilityType: a.ability_type,
      targetType: a.target_type, damageType: a.damage_type, activationMode: a.activation_mode,
      cpCost: a.cp_cost, cpReservePct: a.cp_reserve_pct,
      authoredIntervalMs: a.interval_ms,
      // Existing Combat2 presence effects pulse every heartbeat (closure tests).
      // Retain authoring evidence and publish the explicit runtime transformation.
      intervalMs: a.target_type === 'party' && ['party_regen', 'regen_buff'].includes(a.mechanic_key)
        ? 2000 : a.interval_ms,
      runtimeTransformations: a.target_type === 'party' && ['party_regen', 'regen_buff'].includes(a.mechanic_key)
        ? ['party_presence_interval_is_one_combat2_heartbeat'] : [],
      primaryAttribute: a.primary_attribute ?? null, secondaryAttribute: a.secondary_attribute ?? null,
      accuracyAttribute: a.accuracy_stat ?? null,
      amountCalc: a.amount_calc, durationCalc: a.duration_calc, mechanicCalcs: a.mechanic_calcs,
      effectConfig: a.effect_config, combatText: a.combat_text,
      appliedStatus: a.applied_status ?? null, statusTrigger: a.status_trigger ?? null,
      statusChancePct: a.status_chance_pct ?? null, statusApplicationEnabled: a.status_application_enabled === true,
      onHitEffect: a.on_hit_effect ?? null,
    };
  }).sort((a, b) => a.classKey.localeCompare(b.classKey) || a.classAbilityKey.localeCompare(b.classAbilityKey));
  const identities = abilities.map(a => `${a.classKey}:${a.classAbilityKey}`);
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate class ability identity');
  const catalog = buildAbilityCatalog(abilities, statuses);
  if (catalog.rejected.length) throw new Error(JSON.stringify(catalog.rejected));
  return { schemaVersion: 2, source: source.provenance,
    generatedBy: 'scripts/publish-abilities.mjs', abilityCount: abilities.length,
    statusCount: statuses.length, mechanics: [...new Set(abilities.map(a => a.mechanic))].sort(),
    statuses, abilities };
}
