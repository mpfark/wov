import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    if (!characterId) { setCounts({}); return; }
    const { data } = await supabase
      .from('character_materials')
      .select('material_key, count')
      .eq('character_id', characterId);
    const map: Record<string, number> = {};
    for (const row of data || []) {
      if ((row.count ?? 0) > 0) map[row.material_key] = row.count;
    }
    setCounts(map);
  }, [characterId]);

  useEffect(() => {
    if (!characterId) { setCounts({}); return; }
    void refresh();
    // Realtime on character_materials was disabled to reduce DB activity.
    // Any code path that mutates materials (combat rewards, forges, trades,
    // sells) should dispatch `materials:changed` so all mounted hooks refetch.
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ characterId?: string }>).detail;
      if (!detail?.characterId || detail.characterId === characterId) {
        void refresh();
      }
    };
    window.addEventListener('materials:changed', onChanged as EventListener);
    return () => {
      window.removeEventListener('materials:changed', onChanged as EventListener);
    };
  }, [characterId, refresh]);

  const entries: MaterialEntry[] = catalog.map(m => ({ ...m, count: counts[m.key] ?? 0 }));
  const byCategory = (cat: string) => entries.filter(e => e.category === cat);

  return { catalog, counts, entries, byCategory, refresh };
}

export function notifyMaterialsChanged(characterId?: string | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('materials:changed', {
    detail: { characterId: characterId ?? undefined },
  }));
}

