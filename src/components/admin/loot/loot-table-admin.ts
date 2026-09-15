import { supabase } from '@/integrations/supabase/client';

export const MAX_LOOT_ENTRIES = 200;
export type LootMutationResult =
  | { ok: true; kind: 'created' | 'updated' | 'deleted'; loot_table_id: string; entry_count: number; replayed: boolean }
  | { ok: false; kind: 'not_authenticated' | 'not_authorized' | 'invalid_request' | 'request_conflict' | 'unsupported_operation' | 'loot_table_not_found' | 'entry_not_found' | 'item_not_found' | 'stale_loot_table_state' | 'table_in_use' | 'duplicate_entry' | 'database_error' | 'transport_error' | 'malformed_response'; reference_count?: number };

const refusals = new Set(['not_authenticated', 'not_authorized', 'invalid_request', 'request_conflict', 'unsupported_operation', 'loot_table_not_found', 'entry_not_found', 'item_not_found', 'stale_loot_table_state', 'table_in_use', 'duplicate_entry', 'database_error']);
export function decodeLootMutationResult(value: unknown): LootMutationResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Record<string, unknown>;
  if (result.ok === true && ['created', 'updated', 'deleted'].includes(String(result.kind)) && typeof result.loot_table_id === 'string' && Number.isInteger(result.entry_count) && typeof result.replayed === 'boolean') return result as LootMutationResult;
  if (result.ok === false && typeof result.kind === 'string' && refusals.has(result.kind) && (!('reference_count' in result) || Number.isInteger(result.reference_count))) return result as LootMutationResult;
  return null;
}
export function createLootRequestTracker(make: () => string = () => crypto.randomUUID()) {
  let retry: { fingerprint: string; id: string } | null = null;
  return {
    requestIdFor(fingerprint: string) { if (retry?.fingerprint === fingerprint) return retry.id; retry = { fingerprint, id: make() }; return retry.id; },
    settle(fingerprint: string, keepForTransportRetry: boolean) { if (!keepForTransportRetry && retry?.fingerprint === fingerprint) retry = null; },
  };
}
export async function submitLootMutation(input: Record<string, unknown>, tracker: ReturnType<typeof createLootRequestTracker>): Promise<LootMutationResult> {
  const fingerprint = JSON.stringify(input);
  const { data, error } = await supabase.rpc('admin_mutate_loot_table' as never, { _request_id: tracker.requestIdFor(fingerprint), _operation: input.operation, _loot_table_id: input.lootTableId ?? null, _expected_table: input.expectedTable ?? null, _expected_entries: input.expectedEntries ?? [], _expected_creature_ids: input.expectedCreatureIds ?? [], _desired_name: input.desiredName ?? null, _desired_entries: input.desiredEntries ?? [] } as never);
  const result: LootMutationResult = error ? { ok: false, kind: 'transport_error' } : decodeLootMutationResult(data) ?? { ok: false, kind: 'malformed_response' };
  tracker.settle(fingerprint, !result.ok && result.kind === 'transport_error');
  return result;
}
