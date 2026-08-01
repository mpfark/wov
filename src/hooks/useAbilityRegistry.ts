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
import { USE_CONFIG_ABILITIES } from '@/shared/config/feature-flags';

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
      const { data, error } = await supabase
        .from('class_ability_assignments')
        .select(`
          class_key, unlock_level, is_default, status, ability_id,
          role:class_ability_roles ( id, slot, name ),
          ability:abilities (
            ability_key, label, emoji, description, tooltip, cp_cost, mechanic_key, status,
            amount_calc, duration_calc, interval_ms, effect_config, mechanic_calcs
          )
        `);
      if (cancelled) return;
      if (error) {
        console.error('[ability-registry] load failed, using fallback lists:', error);
        started = false;
        return;
      }
      if (data && data.length > 0) {
        setAbilityRegistry(data as unknown as AbilityConfigRow[]);
        // Phase 2c: same payload also carries the configured magnitudes.
        setAbilityCalcRegistry(data as unknown as AbilityCalcConfigRow[]);
        // Phase 4: the same payload carries non-default alternatives for loadouts.
        setLoadoutOptions(data as unknown as AbilityConfigRow[]);
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { loaded };
}
