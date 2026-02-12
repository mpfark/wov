import { useState, useEffect, useCallback } from 'react';
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
  respawn_seconds: number;
  died_at: string | null;
}

export function useCreatures(nodeId: string | null) {
  const [creatures, setCreatures] = useState<Creature[]>([]);

  const fetchCreatures = useCallback(async () => {
    if (!nodeId) { setCreatures([]); return; }
    // Respawns now handled by server-side scheduled jobs
    const { data } = await supabase
      .from('creatures')
      .select('*')
      .eq('node_id', nodeId)
      .eq('is_alive', true);
    if (data) setCreatures(data as Creature[]);
  }, [nodeId]);

  useEffect(() => {
    fetchCreatures();

    if (!nodeId) return;

    // Subscribe to realtime changes on creatures for this node
    const channel = supabase
      .channel(`creatures-${nodeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'creatures', filter: `node_id=eq.${nodeId}` },
        () => { fetchCreatures(); }
      )
      .subscribe();

    // Periodic respawn check every 30s
    const interval = setInterval(fetchCreatures, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [nodeId, fetchCreatures]);

  return { creatures };
}
