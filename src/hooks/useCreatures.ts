import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Creature {
  id: string;
  name: string;
  description: string;
  node_id: string | null;
  rarity: string;
  level: number;
  hp: number;
  max_hp: number;
  stats: Record<string, number>;
  ac: number;
  is_aggressive: boolean;
  loot_table: any[];
  is_alive: boolean;
}

export function useCreatures(nodeId: string | null) {
  const [creatures, setCreatures] = useState<Creature[]>([]);

  useEffect(() => {
    if (!nodeId) { setCreatures([]); return; }

    const fetchCreatures = async () => {
      const { data } = await supabase
        .from('creatures')
        .select('*')
        .eq('node_id', nodeId)
        .eq('is_alive', true);
      if (data) setCreatures(data as Creature[]);
    };

    fetchCreatures();
  }, [nodeId]);

  return { creatures };
}
