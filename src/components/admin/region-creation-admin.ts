import { supabase } from '@/integrations/supabase/client';

export interface RegionCreationDraft {
  regionName: string;
  regionDescription: string;
  minLevel: number;
  maxLevel: number;
  createInitialNode: boolean;
}

export type RegionCreationResult =
  | { ok: true; kind: 'created'; region_id: string; initial_node_id: string | null; replayed: boolean }
  | { ok: false; kind: 'not_authenticated' | 'not_authorized' | 'invalid_request' | 'request_conflict' | 'coordinate_exhausted' | 'collision' | 'database_error' | 'transport_error' | 'malformed_response' };

const refusalKinds = new Set([
  'not_authenticated', 'not_authorized', 'invalid_request', 'request_conflict',
  'coordinate_exhausted', 'collision', 'database_error',
]);

export function decodeRegionCreationResult(value: unknown): RegionCreationResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.ok === true && row.kind === 'created' && typeof row.region_id === 'string'
      && (row.initial_node_id === null || typeof row.initial_node_id === 'string')
      && typeof row.replayed === 'boolean') return row as RegionCreationResult;
  if (row.ok === false && typeof row.kind === 'string' && refusalKinds.has(row.kind)) return row as RegionCreationResult;
  return null;
}

export function createRegionRequestTracker(createUuid: () => string = () => crypto.randomUUID()) {
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

export async function submitRegionCreation(
  input: RegionCreationDraft,
  tracker: ReturnType<typeof createRegionRequestTracker>,
): Promise<RegionCreationResult> {
  const fingerprint = JSON.stringify(input);
  const requestId = tracker.requestIdFor(fingerprint);
  const { data, error } = await supabase.rpc('admin_create_region_with_initial_node' as never, {
    _request_id: requestId,
    _region_name: input.regionName,
    _region_description: input.regionDescription,
    _min_level: input.minLevel,
    _max_level: input.maxLevel,
    _create_initial_node: input.createInitialNode,
  } as never);
  const result: RegionCreationResult = error
    ? { ok: false, kind: 'transport_error' }
    : decodeRegionCreationResult(data) ?? { ok: false, kind: 'malformed_response' };
  tracker.settle(fingerprint, !result.ok && result.kind === 'transport_error');
  return result;
}
