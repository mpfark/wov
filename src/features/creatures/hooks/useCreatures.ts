import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { NodeChannelHandle } from '@/features/world';
import type { GameNode } from '@/features/world';

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

// ── Client-side reconciliation throttle (10s per node) ────────────
const lastReconcileMap = new Map<string, number>();
const RECONCILE_THROTTLE_MS = 10_000;

/**
 * Trigger server-side effect reconciliation for a specific node.
 * Sends only { node_id } — the server recalculates everything from stored effect data.
 * Client-side throttle: max once per 10s per node (bypassed for force=true or partial retries).
 */
export async function reconcileNode(
  nodeId: string,
  opts: { force?: boolean; _retryCount?: number } = {}
): Promise<Creature[]> {
  const { force = false, _retryCount = 0 } = opts;

  // Client-side throttle (skip for force calls like node-entry, or partial retries)
  if (!force && _retryCount === 0) {
    const last = lastReconcileMap.get(nodeId);
    if (last && Date.now() - last < RECONCILE_THROTTLE_MS) {
      console.log(`[reconcileNode] throttled for ${nodeId}`);
      return [];
    }
  }

  lastReconcileMap.set(nodeId, Date.now());

  const { data, error } = await supabase.functions.invoke('combat-catchup', {
    body: { node_id: nodeId, force },
  });

  if (error) {
    console.error('[reconcileNode] error:', error);
    return [];
  }

  // Handle partial resolution: retry until complete (max 3 retries)
  if (data?.partial && _retryCount < 3) {
    console.warn(`[reconcileNode] partial resolution for ${nodeId}, retrying (${_retryCount + 1}/3)`);
    return reconcileNode(nodeId, { force: true, _retryCount: _retryCount + 1 });
  }

  if (data?.partial) {
    console.error(`[reconcileNode] partial resolution not resolved after 3 retries for ${nodeId}`);
  }

  return (data?.creatures as Creature[]) ?? [];
}

export function useCreatures(nodeId: string | null, handle?: NodeChannelHandle, currentNode?: GameNode | null) {
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [creaturesLoading, setCreaturesLoading] = useState(false);
  const [prefetchedCreatureCount, setPrefetchedCreatureCount] = useState(0);

  const fetchCreatures = useCallback(async (skipCatchup = false) => {
    if (!nodeId) { setCreatures([]); setCreaturesLoading(false); return; }

    setCreaturesLoading(true);

    // Set prefetched count hint for skeleton rows
    const cached = prefetchCache.get(nodeId);
    if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
      setPrefetchedCreatureCount(cached.data.length);
    }

    if (!skipCatchup) {
      const t0 = performance.now();
      // Use reconcileNode with force=true for node-entry (always reconcile, bypass throttle)
      const reconciled = await reconcileNode(nodeId, { force: true });
      const elapsed = performance.now() - t0;
      console.log(`[creatures] catchup for ${nodeId}: ${elapsed.toFixed(0)}ms, ${reconciled.length} creatures`);
      if (reconciled.length > 0) {
        setCreatures(reconciled);
        prefetchCache.delete(nodeId);
        setCreaturesLoading(false);
        return;
      }
      // If reconcileNode returned empty, fall through to DB query as safety net
    }

    // Prefetch cache only used for skipCatchup (respawn interval) or catchup failure
    if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
      setCreatures(cached.data);
      prefetchCache.delete(nodeId);
      setCreaturesLoading(false);
      return;
    }

    // Fallback: direct DB query (used by 30s respawn interval)
    const { data } = await supabase
      .from('creatures')
      .select('*')
      .eq('node_id', nodeId)
      .eq('is_alive', true);
    if (data) setCreatures(data as Creature[]);
    setCreaturesLoading(false);
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
    setCreaturesLoading(true);
    setPrefetchedCreatureCount(0);

    // Set prefetch count hint before async fetch
    if (nodeId) {
      const cached = prefetchCache.get(nodeId);
      if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
        setPrefetchedCreatureCount(cached.data.length);
      }
    }

    fetchCreatures();

    if (!nodeId) return;

    // Periodic respawn check every 30s (safety net) — only if no channel handle (fallback)
    const interval = setInterval(() => fetchCreatures(true), 30000);

    return () => {
      clearInterval(interval);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [nodeId, fetchCreatures]);

  // ── Selective adjacent-node wake-up ─────────────────────────────
  // Only reconcile adjacent nodes that have active effects.
  // Nodes without effects get a cheap direct creature prefetch.
  useEffect(() => {
    if (!currentNode || !currentNode.connections || currentNode.connections.length === 0) return;

    const adjacentNodeIds = currentNode.connections
      .filter(c => !c.hidden)
      .map(c => c.node_id);

    if (adjacentNodeIds.length === 0) return;

    // First: check which adjacent nodes have active effects (lightweight query)
    supabase
      .from('active_effects')
      .select('node_id')
      .in('node_id', adjacentNodeIds)
      .then(({ data: effectNodes }) => {
        const nodesWithEffects = new Set((effectNodes || []).map(e => e.node_id));
        const nodesWithoutEffects = adjacentNodeIds.filter(id => !nodesWithEffects.has(id));

        // Reconcile nodes with active effects (selective wake-up)
        for (const nid of nodesWithEffects) {
          // Use the client throttle — won't spam
          reconcileNode(nid).then(creatures => {
            if (creatures.length > 0) {
              prefetchCache.set(nid, { data: creatures, ts: Date.now() });
            }
          });
        }

        // Cheap prefetch for nodes without effects (no reconciliation needed)
        const staleIds = nodesWithoutEffects.filter(id => {
          const cached = prefetchCache.get(id);
          return !cached || Date.now() - cached.ts >= PREFETCH_TTL;
        });

        if (staleIds.length === 0) return;

        supabase
          .from('creatures')
          .select('*')
          .in('node_id', staleIds)
          .eq('is_alive', true)
          .then(({ data }) => {
            if (!data) return;
            const byNode = new Map<string, Creature[]>();
            for (const id of staleIds) byNode.set(id, []);
            for (const c of data as Creature[]) {
              const arr = byNode.get(c.node_id!);
              if (arr) arr.push(c);
            }
            const now = Date.now();
            for (const [nid, creatures] of byNode) {
              prefetchCache.set(nid, { data: creatures, ts: now });
            }
          });
      });
  }, [currentNode?.id]); // re-run when node changes

  return { creatures, creaturesLoading, prefetchedCreatureCount };
}
