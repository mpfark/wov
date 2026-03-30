import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AreaTypeEntry {
  name: string;
  emoji: string;
}

export function useAreaTypes() {
  const [areaTypes, setAreaTypes] = useState<AreaTypeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTypes = useCallback(async () => {
    const { data } = await supabase.from('area_types').select('name, emoji').order('name');
    if (data) setAreaTypes(data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTypes(); }, [fetchTypes]);

  const emojiMap: Record<string, string> = {};
  for (const t of areaTypes) emojiMap[t.name] = t.emoji;

  return { areaTypes, loading, refetch: fetchTypes, emojiMap };
}
