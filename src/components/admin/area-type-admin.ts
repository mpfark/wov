export type AreaTypeRenameResult =
  | { ok: true; kind: 'renamed'; affected_area_count: number; replayed: boolean }
  | { ok: false; kind: 'not_authenticated' | 'not_authorized' | 'invalid_request' | 'request_conflict' | 'unchanged_name' | 'source_not_found' | 'target_exists' };

export function decodeAreaTypeRenameResult(value: unknown): AreaTypeRenameResult | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (row.ok === true && row.kind === 'renamed' && Number.isInteger(row.affected_area_count) && typeof row.replayed === 'boolean') {
    return row as AreaTypeRenameResult;
  }
  const refusals = ['not_authenticated', 'not_authorized', 'invalid_request', 'request_conflict', 'unchanged_name', 'source_not_found', 'target_exists'];
  if (row.ok === false && typeof row.kind === 'string' && refusals.includes(row.kind)) return row as AreaTypeRenameResult;
  return null;
}
