import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { NodeChannelHandle } from '@/hooks/useNodeChannel';
import type { GameNode } from '@/hooks/useNodes';

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

// Module-level prefetch cache: nodeId → creatures[]
const prefetchCache = new Map<string, { data: Creature[]; ts: number }>();
const PREFETCH_TTL = 30_000; // 30s

export function useCreatures(nodeId: string | null, handle?: NodeChannelHandle, currentNode?: GameNode | null) {
  const [creatures, setCreatures] = useState<Creature[]>([]);

  const fetchCreatures = useCallback(async () => {
    if (!nodeId) { setCreatures([]); return; }

    // Check prefetch cache for instant render, but always follow up with a fresh fetch
    const cached = prefetchCache.get(nodeId);
    if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
      setCreatures(cached.data);
      prefetchCache.delete(nodeId);
      // Don't return — fall through to fresh fetch to catch kills that happened after prefetch
    }

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

  // ── Prefetch adjacent nodes' creatures ──────────────────────────
  useEffect(() => {
    if (!currentNode || !currentNode.connections || currentNode.connections.length === 0) return;

    const adjacentNodeIds = currentNode.connections
      .filter(c => !c.hidden)
      .map(c => c.node_id)
      .filter(id => {
        const cached = prefetchCache.get(id);
        return !cached || Date.now() - cached.ts >= PREFETCH_TTL;
      });

    if (adjacentNodeIds.length === 0) return;

    // Single batched query for all adjacent nodes
    supabase
      .from('creatures')
      .select('*')
      .in('node_id', adjacentNodeIds)
      .eq('is_alive', true)
      .then(({ data }) => {
        if (!data) return;
        // Group by node_id
        const byNode = new Map<string, Creature[]>();
        for (const id of adjacentNodeIds) byNode.set(id, []);
        for (const c of data as Creature[]) {
          const arr = byNode.get(c.node_id!);
          if (arr) arr.push(c);
        }
        const now = Date.now();
        for (const [nid, creatures] of byNode) {
          prefetchCache.set(nid, { data: creatures, ts: now });
        }
      });
  }, [currentNode?.id]); // re-prefetch when node changes

  return { creatures };
}
