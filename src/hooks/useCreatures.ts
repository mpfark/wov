import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { NodeChannelHandle } from '@/hooks/useNodeChannel';

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

export function useCreatures(nodeId: string | null, handle?: NodeChannelHandle) {
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

  // Wire up callback refs from the unified node channel
  useEffect(() => {
    if (!handle) return;

    handle.onCreatureUpdate.current = (payload) => {
      const updated = payload.new as Creature;
      if (updated) {
        setCreatures(prev => {
          if (!updated.is_alive) {
            return prev.filter(c => c.id !== updated.id);
          }
          const exists = prev.some(c => c.id === updated.id);
          if (exists) {
            return prev.map(c => c.id === updated.id ? updated : c);
          }
          return [...prev, updated];
        });
      }
    };

    handle.onCreatureInsert.current = () => { debouncedFetch(); };

    handle.onCreatureDelete.current = (payload) => {
      const deletedId = (payload.old as any)?.id;
      if (deletedId) {
        setCreatures(prev => prev.filter(c => c.id !== deletedId));
      } else {
        debouncedFetch();
      }
    };

    return () => {
      handle.onCreatureUpdate.current = null;
      handle.onCreatureInsert.current = null;
      handle.onCreatureDelete.current = null;
    };
  }, [handle, debouncedFetch]);

  useEffect(() => {
    // Clear stale creatures immediately so downstream effects don't act on old-node data
    setCreatures([]);
    fetchCreatures();

    if (!nodeId) return;

    // Periodic respawn check every 30s (safety net) — only if no channel handle (fallback)
    const interval = setInterval(fetchCreatures, 30000);

    return () => {
      clearInterval(interval);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [nodeId, fetchCreatures]);

  return { creatures };
}
