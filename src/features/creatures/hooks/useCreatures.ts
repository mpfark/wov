/**
 * useCreatures — node creature state with hybrid client-assist / server-authoritative model.
 *
 * State priority (highest wins):
 *   1. Server-authoritative — combat-catchup result + postgres_changes UPDATE/DELETE
 *   2. Broadcast hints      — softDeadIds (kill hints), broadcastOverrides (HP).
 *                              Expire in seconds; never grant rewards or persist.
 *   3. prefetchCache        — last-known snapshot, ≤ PREFETCH_TTL old. Painted on
 *                              entry only, then immediately overwritten by phase-2 reconcile.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeWithRetry } from '@/features/combat/utils/invokeWithRetry';
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
const PREFETCH_TTL = 15_000; // 15s — short enough to avoid stale paints, long enough to beat RTT
const PREHEAT_REFRESH_MS = 5_000; // skip preheat if cache is fresher than this

const isFresh = (entry: { ts: number } | undefined) =>
  !!entry && Date.now() - entry.ts < PREFETCH_TTL;

/**
 * Preheat the prefetch cache for a node we're about to enter.
 * Cheap direct DB read, runs in the background. No-op if cache is already fresh.
 * Safe to call from movement handlers — never throws.
 */
export function preheatNode(nodeId: string | null | undefined): void {
  if (!nodeId) return;
  const cached = prefetchCache.get(nodeId);
  if (cached && Date.now() - cached.ts < PREHEAT_REFRESH_MS) return;
  supabase
    .from('creatures')
    .select('*')
    .eq('node_id', nodeId)
    .eq('is_alive', true)
    .then(({ data }) => {
      if (!data) return;
      prefetchCache.set(nodeId, { data: data as Creature[], ts: Date.now() });
    });
}

// ── Client-side reconciliation throttle (10s per node) ────────────
const lastReconcileMap = new Map<string, number>();
const RECONCILE_THROTTLE_MS = 10_000;

/**
 * Trigger server-side effect reconciliation for a specific node.
 * Sends only { node_id } — the server recalculates everything from stored effect data.
 * Client-side throttle: max once per 10s per node (bypassed for force=true or partial retries).
 */
export interface ReconcileResult {
  creatures: Creature[];
  kill_rewards?: Array<{
    creature_name: string;
    creature_level: number;
    creature_rarity: string;
    xp_each: number;
    gold_each: number;
    salvage_each: number;
    bhp_each: number;
    split_count: number;
    primary_level: number;
  }>;
}

export async function reconcileNode(
  nodeId: string,
  opts: { force?: boolean; _retryCount?: number; reason?: string } = {}
): Promise<ReconcileResult> {
  const { force = false, _retryCount = 0, reason } = opts;

  // Client-side throttle (skip for force calls like node-entry, or partial retries)
  if (!force && _retryCount === 0) {
    const last = lastReconcileMap.get(nodeId);
    if (last && Date.now() - last < RECONCILE_THROTTLE_MS) {
      console.log(`[reconcileNode] throttled for ${nodeId}`);
      return { creatures: [] };
    }
  }

  lastReconcileMap.set(nodeId, Date.now());

  const { data, error } = await invokeWithRetry<any>('combat-catchup', {
    body: { node_id: nodeId, force, ...(reason ? { reason } : {}) },
  });

  if (error) {
    console.error('[reconcileNode] error:', error);
    return { creatures: [] };
  }

  // Handle partial resolution: retry until complete (max 3 retries)
  if (data?.partial && _retryCount < 3) {
    console.warn(`[reconcileNode] partial resolution for ${nodeId}, retrying (${_retryCount + 1}/3)`);
    return reconcileNode(nodeId, { force: true, _retryCount: _retryCount + 1 });
  }

  if (data?.partial) {
    console.error(`[reconcileNode] partial resolution not resolved after 3 retries for ${nodeId}`);
  }

  return {
    creatures: (data?.creatures as Creature[]) ?? [],
    kill_rewards: data?.kill_rewards,
  };
}

export function useCreatures(nodeId: string | null, handle?: NodeChannelHandle, currentNode?: GameNode | null, onCatchupRewards?: (rewards: ReconcileResult['kill_rewards']) => void) {
  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [creaturesLoading, setCreaturesLoading] = useState(false);
  const [prefetchedCreatureCount, setPrefetchedCreatureCount] = useState(0);

  // Reconcile lock: after authoritative fetch, suppress re-adding creatures not in the set
  const reconcileLockRef = useRef<Set<string> | null>(null);
  const reconcileLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancellation token: bumped on every node change so stale async responses
  // from a previous node don't overwrite the current node's state.
  const fetchTokenRef = useRef(0);
  // Mirror of current nodeId for callbacks that fire after async work
  const currentNodeIdRef = useRef<string | null>(nodeId);
  useEffect(() => { currentNodeIdRef.current = nodeId; }, [nodeId]);

  const fetchCreatures = useCallback(async (skipCatchup = false) => {
    if (!nodeId) { setCreatures([]); setCreaturesLoading(false); return; }

    // Capture this fetch's token; if nodeId changes mid-flight, bail out.
    const myToken = ++fetchTokenRef.current;
    const myNodeId = nodeId;
    const isStale = () => fetchTokenRef.current !== myToken || currentNodeIdRef.current !== myNodeId;

    setCreaturesLoading(true);

    // Set prefetched count hint for skeleton rows
    const cached = prefetchCache.get(nodeId);
    if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
      setPrefetchedCreatureCount(cached.data.length);
    }

    if (!skipCatchup) {
      // ── Phase 1: Optimistic display ────────────────────────────
      // Show something within ~100ms instead of waiting for the full reconcile.
      // Prefer the prefetch cache; otherwise fire a fast direct DB read.
      if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
        if (!isStale()) setCreatures(cached.data);
      } else {
        // Fast direct read (no await blocking phase 2 — they race; phase 2 wins)
        supabase
          .from('creatures')
          .select('*')
          .eq('node_id', myNodeId)
          .eq('is_alive', true)
          .then(({ data }) => {
            if (isStale() || !data) return;
            // Only paint if reconcile hasn't already filled in.
            setCreatures(prev => (prev.length === 0 ? (data as Creature[]) : prev));
          });
      }

      // ── Phase 2: Authoritative reconcile ───────────────────────
      const t0 = performance.now();
      const result = await reconcileNode(myNodeId, { force: true });
      if (isStale()) {
        // Node changed while we waited — discard.
        return;
      }
      const elapsed = performance.now() - t0;
      console.log(`[creatures] catchup for ${myNodeId}: ${elapsed.toFixed(0)}ms, ${result.creatures.length} creatures`);

      // Set reconcile lock: only these creature IDs are valid for 150ms.
      // Short window — just enough to swallow stale realtime echoes from before
      // the catchup landed. Respawns are still allowed via the node_id check
      // in onCreatureUpdate (see below).
      const validIds = new Set(result.creatures.map(c => c.id));
      reconcileLockRef.current = validIds;
      if (reconcileLockTimerRef.current) clearTimeout(reconcileLockTimerRef.current);
      reconcileLockTimerRef.current = setTimeout(() => { reconcileLockRef.current = null; }, 150);

      setCreatures(result.creatures);

      // Notify caller about any kill rewards from catchup
      if (result.kill_rewards && result.kill_rewards.length > 0 && onCatchupRewards) {
        onCatchupRewards(result.kill_rewards);
      }
      prefetchCache.delete(myNodeId);
      setCreaturesLoading(false);
      return;
    }

    // Prefetch cache only used for skipCatchup (respawn interval) or catchup failure
    if (cached && Date.now() - cached.ts < PREFETCH_TTL) {
      if (!isStale()) setCreatures(cached.data);
      prefetchCache.delete(myNodeId);
      setCreaturesLoading(false);
      return;
    }

    // Fallback: direct DB query (used by 30s respawn interval)
    const { data } = await supabase
      .from('creatures')
      .select('*')
      .eq('node_id', myNodeId)
      .eq('is_alive', true);
    if (isStale()) return;
    if (data) setCreatures(data as Creature[]);
    setCreaturesLoading(false);
  }, [nodeId, onCatchupRewards]);

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
      if (!updated) return;
      // Drop updates for creatures not at the current node (defense against
      // late events after a node change).
      if (updated.node_id && currentNodeIdRef.current && updated.node_id !== currentNodeIdRef.current) {
        return;
      }
      setCreatures(prev => {
        if (!updated.is_alive) {
          return prev.filter(c => c.id !== updated.id);
        }
        const exists = prev.some(c => c.id === updated.id);
        if (exists) {
          return prev.map(c => c.id === updated.id ? updated : c);
        }
        // During reconcile lock, suppress unknown IDs UNLESS the update
        // describes a freshly-respawned creature at the current node — those
        // should always be shown so respawns aren't swallowed.
        if (reconcileLockRef.current && !reconcileLockRef.current.has(updated.id)) {
          if (updated.is_alive && updated.node_id === currentNodeIdRef.current) {
            return [...prev, updated];
          }
          return prev;
        }
        return [...prev, updated];
      });
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
          reconcileNode(nid).then(result => {
            if (result.creatures.length > 0) {
              prefetchCache.set(nid, { data: result.creatures, ts: Date.now() });
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
