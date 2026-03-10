import { useState, useEffect, useCallback, useRef } from 'react';
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
  loot_table_id: string | null;
  drop_chance: number;
}

export function useCreatures(nodeId: string | null) {
  const [creatures, setCreatures] = useState<Creature[]>([]);

  const fetchCreatures = useCallback(async () => {
    if (!nodeId) { setCreatures([]); return; }
    const { data } = await supabase
      .from('creatures')
      .select('*')
      .eq('node_id', nodeId)
      .eq('is_alive', true);
    if (data) setCreatures(data as Creature[]);
  }, [nodeId]);

  // Debounced fetch — prevents rapid-fire DB queries during combat
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetch = useCallback(() => {
    if (debounceTimer.current) return;
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      fetchCreatures();
    }, 500);
  }, [fetchCreatures]);

  useEffect(() => {
    fetchCreatures();

    if (!nodeId) return;

    // Subscribe to realtime changes on creatures for this node
    const channel = supabase
      .channel(`creatures-${nodeId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'creatures', filter: `node_id=eq.${nodeId}` },
        (payload) => {
          // Inline update for HP changes — avoid full refetch
          const updated = payload.new as Creature;
          if (updated) {
            setCreatures(prev => {
              if (!updated.is_alive) {
                // Creature died — remove from list
                return prev.filter(c => c.id !== updated.id);
              }
              const exists = prev.some(c => c.id === updated.id);
              if (exists) {
                return prev.map(c => c.id === updated.id ? updated : c);
              }
              // Creature respawned — add to list
              return [...prev, updated];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'creatures', filter: `node_id=eq.${nodeId}` },
        () => { debouncedFetch(); }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'creatures', filter: `node_id=eq.${nodeId}` },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (deletedId) {
            setCreatures(prev => prev.filter(c => c.id !== deletedId));
          } else {
            debouncedFetch();
          }
        }
      )
      .subscribe();

    // Periodic respawn check every 15s (safety net)
    const interval = setInterval(fetchCreatures, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [nodeId, fetchCreatures, debouncedFetch]);

  return { creatures };
}
