import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useOwnedGems(characterId: string | null | undefined) {
  const [owned, setOwned] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!characterId) {
      setOwned({});
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from('character_gems')
        .select('gem_key, count')
        .eq('character_id', characterId);
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const row of data || []) {
        if ((row.count ?? 0) > 0) map[row.gem_key] = row.count;
      }
      setOwned(map);
    };
    load();

    const channel = supabase
      .channel(`character_gems:${characterId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_gems', filter: `character_id=eq.${characterId}` },
        () => { void load(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [characterId]);

  return { owned, setOwned };
}
