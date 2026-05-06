import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_WEAPON_PROGRESSION, type WeaponProgressionConfig } from '@/shared/formulas/combat';

/**
 * Subscribe to the singleton `weapon_progression_config` row.
 * Falls back to DEFAULT_WEAPON_PROGRESSION until the fetch resolves
 * or if the row is missing.
 */
export function useWeaponProgression(): WeaponProgressionConfig {
  const [cfg, setCfg] = useState<WeaponProgressionConfig>(DEFAULT_WEAPON_PROGRESSION);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('weapon_progression_config' as any)
        .select('tier1_level, tier2_level, tier3_level')
        .eq('id', 1)
        .maybeSingle();
      if (!cancelled && data) {
        setCfg({
          tier1_level: (data as any).tier1_level,
          tier2_level: (data as any).tier2_level,
          tier3_level: (data as any).tier3_level,
        });
      }
    })();

    const channel = supabase
      .channel('weapon-progression-config')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'weapon_progression_config' },
        (payload) => {
          const r = payload.new as any;
          if (r) {
            setCfg({
              tier1_level: r.tier1_level,
              tier2_level: r.tier2_level,
              tier3_level: r.tier3_level,
            });
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return cfg;
}
