import { supabase } from '@/integrations/supabase/client';
import type { NodeDirection } from './node-connection-admin';

export interface AdjacentNodeDraft {
  parentNodeId: string;
  expectedParentConnections: unknown[];
  direction: NodeDirection;
  nodeFields: Record<string, unknown>;
}
export type AdjacentNodeResult =
  | { ok: true; kind: 'created'; node_id: string; parent_node_id: string; replayed: boolean }
  | { ok: false; kind: 'not_authenticated' | 'not_authorized' | 'invalid_request' | 'request_conflict' | 'parent_not_found' | 'stale_parent_state' | 'direction_occupied' | 'coordinate_collision' | 'malformed_parent_connections' | 'database_error' | 'transport_error' | 'malformed_response' };

const refusals = new Set(['not_authenticated','not_authorized','invalid_request','request_conflict','parent_not_found','stale_parent_state','direction_occupied','coordinate_collision','malformed_parent_connections','database_error']);
export function decodeAdjacentNodeResult(value: unknown): AdjacentNodeResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.ok === true && row.kind === 'created' && typeof row.node_id === 'string' && typeof row.parent_node_id === 'string' && typeof row.replayed === 'boolean') return row as AdjacentNodeResult;
  if (row.ok === false && typeof row.kind === 'string' && refusals.has(row.kind)) return row as AdjacentNodeResult;
  return null;
}
export function createAdjacentNodeRequestTracker(createUuid: () => string = () => crypto.randomUUID()) {
  let retry: { fingerprint: string; requestId: string } | null = null;
  return { requestIdFor(fingerprint: string) { if (retry?.fingerprint === fingerprint) return retry.requestId; retry = { fingerprint, requestId: createUuid() }; return retry.requestId; }, settle(fingerprint: string, retryable: boolean) { if (!retryable && retry?.fingerprint === fingerprint) retry = null; } };
}
export async function submitAdjacentNode(input: AdjacentNodeDraft, tracker: ReturnType<typeof createAdjacentNodeRequestTracker>): Promise<AdjacentNodeResult> {
  const fingerprint = JSON.stringify(input);
  const { data, error } = await supabase.rpc('admin_create_adjacent_node' as never, {
    _request_id: tracker.requestIdFor(fingerprint), _parent_node_id: input.parentNodeId,
    _expected_parent_connections: input.expectedParentConnections, _direction: input.direction, _node_fields: input.nodeFields,
  } as never);
  const result: AdjacentNodeResult = error ? { ok: false, kind: 'transport_error' } : decodeAdjacentNodeResult(data) ?? { ok: false, kind: 'malformed_response' };
  tracker.settle(fingerprint, !result.ok && result.kind === 'transport_error');
  return result;
}
