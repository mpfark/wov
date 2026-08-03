/**
 * useClassRegistry — loads the configurable class rows (`classes` table) into
 * the shared class registry once per session (Phase 2: configurable classes).
 *
 * Until the fetch resolves, the hardcoded fallback tables in
 * `@/shared/formulas/classes` remain in effect — they are byte-identical to
 * the seeded rows, so there is no visible flash of wrong values.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { setClassRegistry, isClassRegistryLoaded, type ClassConfigRow } from '@/shared/formulas/classes';

let started = false;

export function useClassRegistry(): { loaded: boolean } {
  const [loaded, setLoaded] = useState(isClassRegistryLoaded());

  useEffect(() => {
    if (started) {
      setLoaded(isClassRegistryLoaded());
      return;
    }
    started = true;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('classes')
        .select('class_key,label,base_hp,base_ac,crit_range,level_bonuses,weapon_proficiencies,is_pre_class,is_selectable,sort_order,status,primary_attribute,secondary_attribute');
      if (cancelled) return;
      if (error) {
        console.error('[class-registry] load failed, using fallback tables:', error);
        started = false;
        return;
      }
      if (data && data.length > 0) {
        setClassRegistry(data as unknown as ClassConfigRow[]);
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { loaded };
}
