/**
 * useRaceRegistry — loads the configurable race rows (`races` table) into the
 * shared race registry once per session.
 *
 * Until the fetch resolves, the hardcoded fallback tables in
 * `@/shared/formulas/races` remain in effect — they mirror the seeded rows, so
 * there is no visible flash of wrong values.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { setRaceRegistry, isRaceRegistryLoaded, type RaceConfigRow } from '@/shared/formulas/races';

let started = false;

export function useRaceRegistry(): { loaded: boolean } {
  const [loaded, setLoaded] = useState(isRaceRegistryLoaded());

  useEffect(() => {
    if (started) {
      setLoaded(isRaceRegistryLoaded());
      return;
    }
    started = true;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('races' as any)
        .select('race_key,label,description,str,dex,con,int,wis,cha,portrait_notes,is_selectable,status,sort_order');
      if (cancelled) return;
      if (error) {
        console.error('[race-registry] load failed, using fallback tables:', error);
        started = false;
        return;
      }
      if (data && data.length > 0) {
        setRaceRegistry(data as unknown as RaceConfigRow[]);
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { loaded };
}
