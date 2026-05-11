import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MaterialDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  rarity: string;
  category: string;
  tradeable: boolean;
  stack_max: number | null;
  value: number;
  sort_order: number;
}

export interface MaterialEntry extends MaterialDef {
  count: number;
}

export function useMaterials(characterId: string | null | undefined) {
  const [catalog, setCatalog] = useState<MaterialDef[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    supabase.from('materials').select('*').order('sort_order').then(({ data }) => {
      if (!cancelled) setCatalog((data ?? []) as MaterialDef[]);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!characterId) { setCounts({}); return; }
    let cancelled = false;

    const load = async () => {
      const { data } = await supabase
        .from('character_materials')
        .select('material_key, count')
        .eq('character_id', characterId);
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const row of data || []) {
        if ((row.count ?? 0) > 0) map[row.material_key] = row.count;
      }
      setCounts(map);
    };
    load();

    const channel = supabase
      .channel(`character_materials:${characterId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'character_materials', filter: `character_id=eq.${characterId}` },
        () => { void load(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [characterId]);

  const entries: MaterialEntry[] = catalog.map(m => ({ ...m, count: counts[m.key] ?? 0 }));
  const byCategory = (cat: string) => entries.filter(e => e.category === cat);

  return { catalog, counts, entries, byCategory };
}
