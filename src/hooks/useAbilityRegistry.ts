/**
 * useAbilityRegistry — loads configured class abilities into the shared ability
 * registry once per session (Phase 2b: configurable abilities).
 *
 * Until the fetch resolves (or when `USE_CONFIG_ABILITIES` is off), the
 * hardcoded fallback lists in `@/features/combat/utils/class-abilities` remain
 * in effect. They are balance-identical to the seeded rows, so there is no
 * flash of wrong CP costs or unlock levels.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  setAbilityRegistry, isAbilityRegistryLoaded, type AbilityConfigRow,
} from '@/features/combat/utils/class-abilities';
import {
  setAbilityCalcRegistry, type AbilityCalcConfigRow,
} from '@/features/combat/utils/ability-calcs';
import { setLoadoutOptions } from '@/features/combat/utils/ability-loadout';
import { setAbilityTextRegistry } from '@/features/combat/utils/ability-text';
import { USE_CONFIG_ABILITIES } from '@/shared/config/feature-flags';
import { applyAssignmentOverrides } from '@/shared/config/effective-ability';
import { composeAbilityRow, indexAppliedStatuses } from '@/shared/config/compose-ability';
import { getClassScaling } from '@/shared/formulas/classes';

let started = false;

export function useAbilityRegistry(): { loaded: boolean } {
  const [loaded, setLoaded] = useState(isAbilityRegistryLoaded());

  useEffect(() => {
    if (!USE_CONFIG_ABILITIES) return;
    if (started) {
      setLoaded(isAbilityRegistryLoaded());
      return;
    }
    started = true;
    let cancelled = false;

    (async () => {
      const [{ data, error }, { data: statusRows }] = await Promise.all([
        supabase
          .from('class_ability_assignments')
          .select(`
            class_key, class_ability_key, unlock_level, is_default, status, ability_id, overrides,
            role:class_ability_roles ( id, slot, name ),
            ability:abilities (
              ability_key, label, description, tooltip, mechanic_key, ability_type, status,
              damage_type, combat_text, class_scale, primary_attribute, secondary_attribute,
              applied_status, on_hit_effect,
              base:base_abilities (
                base_key, mechanic_key, activation_mode, target_type, default_target_type,
                cp_cost, cp_reserve_pct, amount_calc, duration_calc, interval_ms,
                mechanic_calcs, effect_config, on_hit_allowed, supports_secondary_scaling
              )
            )
          `),
        supabase.from('applied_statuses').select('*'),
      ]);
      if (cancelled) return;
      if (error) {
        console.error('[ability-registry] load failed, using fallback lists:', error);
        started = false;
        return;
      }
      if (data && data.length > 0) {
        // Two-layer composition first (base numbers + configured-use identity),
        // then the class-override resolver.
        const statuses = indexAppliedStatuses((statusRows ?? []) as any);
        const rowsIn = (data as any[]).map(row => (
          row?.ability
            ? { ...row, ability: { ...row.ability, ...composeAbilityRow(row.ability, row.ability.base, statuses) } }
            : row
        ));
        // ONE resolver: base ability + validated class overrides, applied at the
        // fetch boundary so no consumer can read an unmerged base row.
        const { rows, errors: overrideErrors } = applyAssignmentOverrides(
          rowsIn as unknown as { class_key?: string; overrides?: unknown; ability?: any }[],
          k => getClassScaling(k) as any,
        );
        if (overrideErrors.length > 0) {
          console.error('[ability-registry] invalid assignment overrides ignored:', overrideErrors);
        }
        const resolved = rows as unknown as AbilityConfigRow[];
        setAbilityRegistry(resolved);
        // Phase 2c: same payload also carries the configured magnitudes.
        setAbilityCalcRegistry(resolved as unknown as AbilityCalcConfigRow[]);
        // Phase 4: the same payload carries non-default alternatives for loadouts.
        setLoadoutOptions(resolved);
        // Authored ability-identity combat text (Fireball vs Frost Bolt).
        // Register authored text under BOTH the base key and the per-class key,
        // because the server stamps events with the per-class identity.
        setAbilityTextRegistry(
          (resolved as unknown as {
            class_ability_key?: string | null;
            ability: { ability_key?: string; combat_text?: unknown } | null;
          }[]).flatMap(r => {
            if (!r.ability) return [];
            const rows = [r.ability];
            if (r.class_ability_key && r.class_ability_key !== r.ability.ability_key) {
              rows.push({ ...r.ability, ability_key: r.class_ability_key });
            }
            return rows;
          }),
        );
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { loaded };
}
