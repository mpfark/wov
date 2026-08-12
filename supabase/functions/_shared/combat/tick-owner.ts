/**
 * tick-owner.ts — B4: the ownership latch read by the resolvers.
 *
 * `combat_tick_owner()` (Postgres, backed by `combat_config`) decides which
 * execution path a tick takes:
 *
 * - `legacy` — the client's request payload (`pending_abilities`) is the
 *   intent source, exactly as before this change.
 * - `shared` — durable `combat_actions` rows are the ONLY intent source; the
 *   request payload is ignored entirely.
 *
 * Both paths ship in the deployed function. The env var `COMBAT_TICK_OWNER`
 * overrides the config row (useful for a single-function canary); anything
 * unrecognised falls back to `legacy`, so a failed read can never flip
 * behaviour.
 */

export type TickOwner = 'legacy' | 'shared';

function coerceOwner(value: unknown): TickOwner | null {
  return value === 'shared' || value === 'legacy' ? value : null;
}

export async function resolveTickOwner(db: any): Promise<TickOwner> {
  const envOwner = coerceOwner(Deno.env.get('COMBAT_TICK_OWNER'));
  if (envOwner) return envOwner;
  try {
    const { data, error } = await db.rpc('combat_tick_owner');
    if (error) {
      console.warn('[tick-owner] combat_tick_owner() failed', error.message);
      return 'legacy';
    }
    return coerceOwner(data) ?? 'legacy';
  } catch (e) {
    console.warn('[tick-owner] combat_tick_owner() threw', (e as Error).message);
    return 'legacy';
  }
}

/** The shape the resolver consumes for a queued cast. */
export interface DurableIntent {
  character_id: string;
  action_id: string;
  ability_key: string;
  ability_type?: string | null;
  target_creature_id: string | null;
  target_character_id: string | null;
  client_seq: number;
}

/**
 * Read this encounter's pending intent. One slot per character (lowest
 * `client_seq`, then earliest `created_at`) so ordering is deterministic and a
 * retry of the same tick reads the same set.
 */
export async function loadDurableIntents(
  db: any,
  args: { nodeId: string; characterIds: readonly string[]; nowMs?: number },
): Promise<DurableIntent[]> {
  if (args.characterIds.length === 0) return [];
  const { data, error } = await db
    .from('combat_actions')
    .select('id, character_id, ability_key, target_creature_id, target_character_id, client_seq, created_at, eligible_after_ms, submitted_at')
    .eq('node_id', args.nodeId)
    .eq('status', 'pending')
    .in('character_id', args.characterIds as string[])
    .order('character_id', { ascending: true })
    .order('client_seq', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[tick-owner] durable intent read failed', error.message);
    return [];
  }
  const now = args.nowMs ?? Date.now();
  const firstPerCharacter = new Map<string, DurableIntent>();
  for (const row of (data || []) as any[]) {
    const delay = Number(row.eligible_after_ms) || 0;
    if (delay > 0) {
      const submitted = Date.parse(row.submitted_at ?? row.created_at ?? '') || 0;
      if (submitted && now < submitted + delay) continue;
    }
    if (firstPerCharacter.has(row.character_id)) continue;
    firstPerCharacter.set(row.character_id, {
      character_id: row.character_id,
      action_id: row.id,
      ability_key: row.ability_key,
      ability_type: null,
      target_creature_id: row.target_creature_id ?? null,
      target_character_id: row.target_character_id ?? null,
      client_seq: Number(row.client_seq) || 0,
    });
  }
  return [...firstPerCharacter.values()];
}
