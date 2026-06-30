/**
 * visitedNodesCache — client-side dedup for character_visited_nodes upserts.
 *
 * Background: every movement upserted into character_visited_nodes — the #1
 * DB hotspot (~42k calls). The table is append-only and only used for
 * "have I seen this node" map shading, so re-upserting a node that's
 * already visited is pure waste.
 *
 * This module keeps a per-character Set of visited node ids. It seeds
 * lazily from the DB on first access for a character, then short-circuits
 * subsequent upserts. The upsert still runs for new nodes so the DB is
 * the source of truth.
 *
 * Gameplay impact: none. This only affects whether we send an upsert that
 * the DB would have absorbed as a no-op anyway.
 */
import { supabase } from '@/integrations/supabase/client';

const visited = new Map<string, Set<string>>();
const seeding = new Map<string, Promise<Set<string>>>();

async function seed(characterId: string): Promise<Set<string>> {
  const existing = seeding.get(characterId);
  if (existing) return existing;
  const p = (async () => {
    const { data } = await supabase
      .from('character_visited_nodes')
      .select('node_id')
      .eq('character_id', characterId);
    const set = new Set<string>((data ?? []).map((r: any) => r.node_id as string));
    visited.set(characterId, set);
    return set;
  })();
  seeding.set(characterId, p);
  try { return await p; } finally { seeding.delete(characterId); }
}

/**
 * Mark a node as visited for a character. Upserts the row only if we
 * haven't already recorded it locally (after seeding from DB). Safe to
 * fire-and-forget.
 */
export async function markNodeVisited(characterId: string, nodeId: string): Promise<void> {
  let set = visited.get(characterId);
  if (!set) set = await seed(characterId);
  if (set.has(nodeId)) return;
  set.add(nodeId);
  const { error } = await supabase
    .from('character_visited_nodes')
    .upsert(
      { character_id: characterId, node_id: nodeId },
      { onConflict: 'character_id,node_id' },
    );
  if (error) {
    // Roll the local cache back so a retry can happen next time.
    set.delete(nodeId);
    return;
  }
  // Reaching a node may consume any treasure-map quest items the player
  // owns that point at this node. Fire-and-forget; if any rows were
  // deleted, signal the inventory hook to refetch.
  try {
    const { data } = await supabase.rpc('consume_maps_for_node' as any, {
      _character_id: characterId,
      _node_id: nodeId,
    });
    if ((data as number | null) && (data as number) > 0) {
      window.dispatchEvent(new CustomEvent('inventory:changed'));
    }
  } catch {
    /* non-critical */
  }
}

/** Allow callers that already SELECT visited nodes to prime the cache. */
export function primeVisitedNodes(characterId: string, nodeIds: Iterable<string>): void {
  const set = visited.get(characterId) ?? new Set<string>();
  for (const id of nodeIds) set.add(id);
  visited.set(characterId, set);
}
