import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { NEUTRAL_AREA_COLOR } from '../utils/area-colors';

export interface AreaTypeEntry {
  name: string;
  /** Stored `H S L` triplet used for map presentation. */
  color: string;
}

export function useAreaTypes() {
  const [areaTypes, setAreaTypes] = useState<AreaTypeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTypes = useCallback(async () => {
    const { data } = await supabase.from('area_types').select('name, color').order('name');
    if (data) {
      setAreaTypes(
        (data as { name: string; color: string | null }[]).map(t => ({
          name: t.name,
          color: t.color || NEUTRAL_AREA_COLOR,
        })),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  /** area_type name -> stored `H S L` triplet (neutral fallback when unknown). */
  const colorMap: Record<string, string> = {};
  for (const t of areaTypes) colorMap[t.name] = t.color;

  return { areaTypes, loading, refetch: fetchTypes, colorMap };
}
