/**
 * useCreatures — single node-tagged roster owner.
 *
 * AUTHORITY MODEL
 *   The actionable roster comes from exactly one source: the read-only RPC
 *   `public.node_creature_roster(character_id)`, which resolves the node
 *   SERVER-SIDE from the owned character's `current_node_id`. Nothing else can
 *   mark a roster authoritative, and Attack is only enabled for an
 *   authoritative roster belonging to the currently displayed node.
 *
 *   - Authoritative RPC establishes the roster and its generation.
 *   - Realtime events update that roster afterwards (spawn_seq guarded).
 *   - The safety refetch replaces it only for the same node + request id.
 *   - Prefetch / plain table reads seed presentation only: `authoritative`
 *     stays false, so they can never enable combat.
 *
 *   `combat-catchup` is an internal service-role endpoint. The client never
 *   calls it. Offscreen effects-only progression is internal authority and
 *   currently has no deployed internal caller (tracked separately).
 */
import { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
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
  spawn_seq?: number | null;
}

export type RosterStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'unauthorized'
  | 'error';

export interface RosterState {
  nodeId: string | null;
  requestId: number;
  status: RosterStatus;
  creatures: Creature[];
  /** True only after a successful RPC response for exactly this nodeId. */
  authoritative: boolean;
  /** Advisory only — never suppresses living creatures. */
  realmAwake: boolean;
  respawnPending: number;
  error: string | null;
}

// ── Prefetch cache (presentation only, never authoritative) ──────
const prefetchCache = new Map<string, { data: Creature[]; ts: number }>();
const PREFETCH_TTL = 15_000;
const PREHEAT_REFRESH_MS = 5_000;

const isFresh = (entry: { ts: number } | undefined) =>
  !!entry && Date.now() - entry.ts < PREFETCH_TTL;

/**
 * Preheat the presentation cache for a node we're about to enter.
 * Never authoritative — purely a paint-sooner hint. Safe to call from
 * movement handlers; never throws.
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

// ── Authoritative roster fetch ───────────────────────────────────

export interface RosterResponse {
  node_id: string;
  realm_awake: boolean;
  respawn_pending: number;
  creatures: Creature[];
}

export type RosterOutcome =
  | { kind: 'ok'; data: RosterResponse }
  | { kind: 'unauthorized'; reason: string }
  | { kind: 'error'; reason: string };

/** Classify a postgres error message into a roster outcome. */
function classifyRosterError(message: string): RosterOutcome {
  const m = message.toLowerCase();
  if (m.includes('not_owned') || m.includes('unauthorized') || m.includes('permission denied')) {
    return { kind: 'unauthorized', reason: message };
  }
  return { kind: 'error', reason: message };
}

/**
 * Read the authoritative roster for the character's CURRENT node.
 * No node argument exists by design: an arbitrary node id can never become
 * the actionable roster.
 */
export async function fetchNodeRoster(characterId: string): Promise<RosterOutcome> {
  if (!characterId) return { kind: 'error', reason: 'missing character' };
  const { data, error } = await supabase.rpc('node_creature_roster', {
    _character_id: characterId,
  });
  if (error) return classifyRosterError(error.message ?? 'roster read failed');
  const payload = data as unknown as RosterResponse | null;
  if (!payload || typeof payload.node_id !== 'string') {
    return { kind: 'error', reason: 'malformed roster response' };
  }
  return {
    kind: 'ok',
    data: {
      node_id: payload.node_id,
      realm_awake: !!payload.realm_awake,
      respawn_pending: Number(payload.respawn_pending ?? 0),
      creatures: (payload.creatures ?? []).filter(c => c.is_alive),
    },
  };
}

// ── Reducer: the single roster owner ─────────────────────────────

type RosterAction =
  /** Node changed (or first mount): hard reset, tagged with the new node. */
  | { type: 'begin'; nodeId: string | null; requestId: number }
  /** Non-authoritative paint from cache / plain read. Must match active node. */
  | { type: 'seed'; nodeId: string; requestId: number; creatures: Creature[] }
  | { type: 'resolved'; nodeId: string; requestId: number; data: RosterResponse }
  | { type: 'failed'; nodeId: string; requestId: number; status: 'error' | 'unauthorized'; reason: string }
  | { type: 'realtimeUpsert'; nodeId: string; creature: Creature }
  | { type: 'realtimeRemove'; id: string };

const initialRoster: RosterState = {
  nodeId: null,
  requestId: 0,
  status: 'idle',
  creatures: [],
  authoritative: false,
  realmAwake: true,
  respawnPending: 0,
  error: null,
};

/** A response is only allowed to mutate state when node AND request match. */
const matches = (s: RosterState, nodeId: string, requestId: number) =>
  s.nodeId === nodeId && s.requestId === requestId;

function rosterReducer(state: RosterState, action: RosterAction): RosterState {
  switch (action.type) {
    case 'begin':
      return {
        ...initialRoster,
        nodeId: action.nodeId,
        requestId: action.requestId,
        status: action.nodeId ? 'loading' : 'idle',
      };

    case 'seed': {
      if (!matches(state, action.nodeId, action.requestId)) return state;
      // Never downgrade an authoritative roster with cached data.
      if (state.authoritative) return state;
      if (state.creatures.length > 0) return state;
      return { ...state, creatures: action.creatures };
    }

    case 'resolved': {
      if (!matches(state, action.nodeId, action.requestId)) return state;
      const creatures = action.data.creatures;
      return {
        ...state,
        // realm_awake=false / respawn_pending>0 are advisory: living creatures
        // stay visible and actionable.
        status: creatures.length > 0 ? 'ready' : 'empty',
        creatures,
        authoritative: true,
        realmAwake: action.data.realm_awake,
        respawnPending: action.data.respawn_pending,
        error: null,
      };
    }

    case 'failed': {
      if (!matches(state, action.nodeId, action.requestId)) return state;
      if (state.authoritative) {
        // Same-node refresh failure: keep the valid roster, surface the error.
        return { ...state, error: action.reason };
      }
      // Never actionable, never the previous node's creatures.
      return {
        ...state,
        status: action.status,
        creatures: [],
        authoritative: false,
        error: action.reason,
      };
    }

    case 'realtimeUpsert': {
      const c = action.creature;
      if (state.nodeId !== action.nodeId) return state;
      // Realtime may only refine an authoritative roster; it can never
      // manufacture one for a node we have not authoritatively loaded.
      if (!state.authoritative) return state;
      const existing = state.creatures.find(x => x.id === c.id);
      // spawn_seq guard: a stale generation may never overwrite a newer one.
      if (existing && (existing.spawn_seq ?? 0) > (c.spawn_seq ?? 0)) return state;
      if (!c.is_alive) {
        if (!existing) return state;
        const creatures = state.creatures.filter(x => x.id !== c.id);
        return { ...state, creatures, status: creatures.length > 0 ? 'ready' : 'empty' };
      }
      if (c.node_id !== state.nodeId) {
        if (!existing) return state;
        const creatures = state.creatures.filter(x => x.id !== c.id);
        return { ...state, creatures, status: creatures.length > 0 ? 'ready' : 'empty' };
      }
      const creatures = existing
        ? state.creatures.map(x => (x.id === c.id ? { ...x, ...c } : x))
        : [...state.creatures, c];
      return { ...state, creatures, status: 'ready' };
    }

    case 'realtimeRemove': {
      if (!state.creatures.some(c => c.id === action.id)) return state;
      const creatures = state.creatures.filter(c => c.id !== action.id);
      return { ...state, creatures, status: state.authoritative && creatures.length === 0 ? 'empty' : state.status };
    }

    default:
      return state;
  }
}

export function useCreatures(
  nodeId: string | null,
  handle?: NodeChannelHandle,
  currentNode?: GameNode | null,
  softDeadIds?: Set<string>,
  characterId?: string | null,
) {
  const [roster, dispatch] = useReducer(rosterReducer, initialRoster);
  const [prefetchedCreatureCount, setPrefetchedCreatureCount] = useState(0);

  // Locally hidden ids (confirmed kills) — presentation only, never state.
  const [locallyRemoved, setLocallyRemoved] = useState<Set<string>>(new Set());

  const requestIdRef = useRef(0);
  const rosterRef = useRef(roster);
  useEffect(() => { rosterRef.current = roster; }, [roster]);
  const nodeIdRef = useRef<string | null>(nodeId);
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);

  /**
   * Authoritative load for the current node.
   * `newGeneration` starts a fresh generation (node change / resubscribe);
   * otherwise the current generation is refreshed in place.
   */
  const loadRoster = useCallback(async (newGeneration: boolean) => {
    const myNodeId = nodeIdRef.current;
    if (!myNodeId) {
      dispatch({ type: 'begin', nodeId: null, requestId: ++requestIdRef.current });
      return;
    }

    let requestId = rosterRef.current.requestId;
    if (newGeneration || rosterRef.current.nodeId !== myNodeId) {
      requestId = ++requestIdRef.current;
      dispatch({ type: 'begin', nodeId: myNodeId, requestId });

      // Non-authoritative paint from the presentation cache, tagged to this node.
      const cached = prefetchCache.get(myNodeId);
      if (isFresh(cached)) {
        setPrefetchedCreatureCount(cached!.data.length);
        dispatch({ type: 'seed', nodeId: myNodeId, requestId, creatures: cached!.data });
      } else {
        supabase
          .from('creatures')
          .select('*')
          .eq('node_id', myNodeId)
          .eq('is_alive', true)
          .then(({ data }) => {
            if (!data) return;
            dispatch({ type: 'seed', nodeId: myNodeId, requestId, creatures: data as Creature[] });
          });
      }
    }

    if (!characterId) {
      dispatch({ type: 'failed', nodeId: myNodeId, requestId, status: 'unauthorized', reason: 'no character identity' });
      return;
    }

    const outcome = await fetchNodeRoster(characterId);
    if (outcome.kind === 'ok') {
      // The server resolved the node itself; if it disagrees with the node we
      // are displaying the response belongs to a different (stale) position.
      if (outcome.data.node_id !== myNodeId) return;
      prefetchCache.set(myNodeId, { data: outcome.data.creatures, ts: Date.now() });
      dispatch({ type: 'resolved', nodeId: myNodeId, requestId, data: outcome.data });
      return;
    }
    dispatch({
      type: 'failed',
      nodeId: myNodeId,
      requestId,
      status: outcome.kind === 'unauthorized' ? 'unauthorized' : 'error',
      reason: outcome.reason,
    });
  }, [characterId]);

  // Debounced same-generation refresh (realtime INSERT bursts).
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefresh = useCallback(() => {
    if (debounceTimer.current) return;
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      loadRoster(false);
    }, 500);
  }, [loadRoster]);

  // ── Realtime wiring ───────────────────────────────────────────
  useEffect(() => {
    if (!handle) return;

    handle.onCreatureUpdate.current = (payload) => {
      const updated = payload.new as Creature;
      const active = nodeIdRef.current;
      if (!updated || !active) return;
      dispatch({ type: 'realtimeUpsert', nodeId: active, creature: updated });
    };

    handle.onCreatureInsert.current = () => { debouncedRefresh(); };

    handle.onCreatureDelete.current = (payload) => {
      const deletedId = (payload.old as any)?.id;
      if (deletedId) dispatch({ type: 'realtimeRemove', id: deletedId });
      else debouncedRefresh();
    };

    return () => {
      handle.onCreatureUpdate.current = null;
      handle.onCreatureInsert.current = null;
      handle.onCreatureDelete.current = null;
    };
  }, [handle, debouncedRefresh]);

  // ── Node change: new generation ───────────────────────────────
  useEffect(() => {
    setPrefetchedCreatureCount(0);
    setLocallyRemoved(new Set());
    loadRoster(true);

    if (!nodeId) return;
    // Safety refresh — same node, same generation.
    const interval = setInterval(() => loadRoster(false), 30000);
    return () => {
      clearInterval(interval);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [nodeId, loadRoster]);

  // ── Realtime resubscribe / reconnect ⇒ fresh authoritative fetch ──
  useEffect(() => {
    if (!handle || !nodeId) return;
    let known = handle.channelRef.current;
    const poll = setInterval(() => {
      const current = handle.channelRef.current;
      if (current && current !== known) {
        known = current;
        loadRoster(true);
      }
    }, 2000);
    const onOnline = () => loadRoster(true);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(poll);
      window.removeEventListener('online', onOnline);
    };
  }, [handle, nodeId, loadRoster]);

  // ── Adjacent-node prefetch — explicitly non-interactive ───────
  // Fills the presentation cache only. It never marks a roster authoritative
  // for the displayed node and never enables Attack; after movement the
  // current-node RPC revalidates before anything becomes actionable.
  useEffect(() => {
    if (!currentNode || !currentNode.connections || currentNode.connections.length === 0) return;
    const adjacentNodeIds = currentNode.connections.filter(c => !c.hidden).map(c => c.node_id);
    const staleIds = adjacentNodeIds.filter(id => !isFresh(prefetchCache.get(id)));
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
        for (const [nid, list] of byNode) prefetchCache.set(nid, { data: list, ts: now });
      });
  }, [currentNode?.id]);

  /**
   * Presentational hard-hide used when combat-tick confirms a kill, so the
   * corpse disappears even if the realtime UPDATE is delayed. Does not touch
   * roster authority; respawns reappear via realtime / the next fetch.
   */
  const removeCreatureLocal = useCallback((id: string) => {
    setLocallyRemoved(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const visibleCreatures = useMemo(() => {
    let list = roster.creatures;
    if (locallyRemoved.size > 0) list = list.filter(c => !locallyRemoved.has(c.id));
    if (softDeadIds && softDeadIds.size > 0) list = list.filter(c => !softDeadIds.has(c.id));
    return list;
  }, [roster.creatures, locallyRemoved, softDeadIds]);

  /** Attack may only be offered for an authoritative roster of this node. */
  const rosterActionable = roster.authoritative
    && roster.nodeId === nodeId
    && (roster.status === 'ready' || roster.status === 'empty');

  return {
    creatures: visibleCreatures,
    creaturesLoading: roster.status === 'loading',
    prefetchedCreatureCount,
    removeCreatureLocal,
    rosterStatus: roster.status,
    rosterActionable,
    rosterAuthoritative: roster.authoritative,
    rosterError: roster.error,
    realmAwake: roster.realmAwake,
    respawnPending: roster.respawnPending,
    refreshRoster: () => loadRoster(true),
  };
}

export { rosterReducer, initialRoster };
export type { RosterAction };
