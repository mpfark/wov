import { supabase } from '@/integrations/supabase/client';

export const NODE_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type NodeDirection = typeof NODE_DIRECTIONS[number];
export type ConnectionOperation = 'create' | 'edit' | 'remove';
export type ConnectionEntry = Record<string, unknown> & { node_id: string; direction: string; hidden?: boolean };

export interface ConnectionMutation {
  requestId: string;
  operation: ConnectionOperation;
  sourceNodeId: string;
  targetNodeId: string;
  expectedSourceEntry: ConnectionEntry | null;
  expectedTargetEntry: ConnectionEntry | null;
  desiredDirection?: NodeDirection;
  desiredHidden?: boolean;
  desiredSourceDirectionalMetadata?: Record<string, unknown>;
}
export type ConnectionMutationDraft = Omit<ConnectionMutation, 'requestId'>;

export type ConnectionMutationResult =
  | { ok: true; kind: 'created' | 'edited' | 'removed'; source_node_id: string; target_node_id: string; replayed: boolean }
  | { ok: false; kind: 'not_authenticated' | 'not_authorized' | 'invalid_request' | 'request_conflict' | 'node_not_found' | 'malformed_connection_state' | 'connection_exists_or_conflicts' | 'not_an_ordinary_reciprocal_pair' | 'conflicting_reciprocal_state' | 'stale_connection_state' | 'transport_error' | 'malformed_response' };

const refusalKinds = new Set([
  'not_authenticated', 'not_authorized', 'invalid_request', 'request_conflict', 'node_not_found',
  'malformed_connection_state', 'connection_exists_or_conflicts', 'not_an_ordinary_reciprocal_pair',
  'conflicting_reciprocal_state', 'stale_connection_state',
]);

export function decodeConnectionMutationResult(value: unknown): ConnectionMutationResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.ok === true && ['created', 'edited', 'removed'].includes(String(row.kind))
      && typeof row.source_node_id === 'string' && typeof row.target_node_id === 'string'
      && typeof row.replayed === 'boolean') return row as ConnectionMutationResult;
  if (row.ok === false && typeof row.kind === 'string' && refusalKinds.has(row.kind)) return row as ConnectionMutationResult;
  return null;
}

export function directionalMetadata(input: { label?: string; locked?: boolean; lock_key?: string; lock_hint?: string }) {
  const result: Record<string, unknown> = {};
  if (input.label?.trim()) result.label = input.label.trim();
  if (input.locked) {
    result.locked = true;
    if (input.lock_key?.trim()) result.lock_key = input.lock_key.trim();
    if (input.lock_hint?.trim()) result.lock_hint = input.lock_hint.trim();
  }
  return result;
}

export async function mutateReciprocalConnection(input: ConnectionMutation): Promise<ConnectionMutationResult> {
  const { data, error } = await supabase.rpc('admin_mutate_reciprocal_node_connection' as never, {
    _request_id: input.requestId,
    _operation: input.operation,
    _source_node_id: input.sourceNodeId,
    _target_node_id: input.targetNodeId,
    _expected_source_entry: input.expectedSourceEntry,
    _expected_target_entry: input.expectedTargetEntry,
    _desired_direction: input.desiredDirection ?? null,
    _desired_hidden: input.desiredHidden ?? null,
    _desired_source_directional_metadata: input.desiredSourceDirectionalMetadata ?? {},
  } as never);
  if (error) return { ok: false, kind: 'transport_error' };
  return decodeConnectionMutationResult(data) ?? { ok: false, kind: 'malformed_response' };
}

export function createConnectionRequestTracker(createUuid: () => string = () => crypto.randomUUID()) {
  let retry: { fingerprint: string; requestId: string } | null = null;
  return {
    requestIdFor(fingerprint: string) {
      if (retry?.fingerprint === fingerprint) return retry.requestId;
      retry = { fingerprint, requestId: createUuid() };
      return retry.requestId;
    },
    settle(fingerprint: string, retryable: boolean) {
      if (!retryable && retry?.fingerprint === fingerprint) retry = null;
    },
  };
}

export async function submitReciprocalConnection(
  input: ConnectionMutationDraft,
  tracker: ReturnType<typeof createConnectionRequestTracker>,
) {
  const fingerprint = JSON.stringify(input);
  const result = await mutateReciprocalConnection({ ...input, requestId: tracker.requestIdFor(fingerprint) });
  tracker.settle(fingerprint, !result.ok && result.kind === 'transport_error');
  return result;
}

export function findExactConnection(connections: unknown, targetNodeId: string): ConnectionEntry | null {
  if (!Array.isArray(connections)) return null;
  const matches = connections.filter((entry): entry is ConnectionEntry => !!entry && typeof entry === 'object' && (entry as ConnectionEntry).node_id === targetNodeId);
  return matches.length === 1 ? { ...matches[0] } : null;
}
