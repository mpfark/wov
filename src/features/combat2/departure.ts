export type Combat2DepartureOutcome =
  | { status: 'moved'; classification: 'moved' | 'already_moved'; originNodeId: string; destinationNodeId: string; cost: number }
  | { status: 'queued'; classification: 'queued' | 'already_queued'; originNodeId: string; destinationNodeId: string; cost: number }
  | { status: 'dead'; classification: 'dead'; originNodeId: string; destinationNodeId: string; cost: number }
  | { status: 'refused'; classification: string; reason: string | null };

export interface Combat2DepartureAdapter {
  depart(characterId: string, destinationNodeId: string, requestId: string): Promise<Combat2DepartureOutcome>;
}

export class Combat2DepartureError extends Error {
  constructor(readonly code: 'uncertain' | 'error', message: string) { super(message); this.name = 'Combat2DepartureError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function decodeCombat2Departure(value: unknown): Combat2DepartureOutcome {
  const row = record(value);
  if (!row || typeof row.ok !== 'boolean' || typeof row.kind !== 'string') throw new Combat2DepartureError('error', 'combat2_depart returned a malformed response');
  if (row.ok) {
    if (!['moved', 'already_moved', 'queued', 'already_queued', 'dead'].includes(row.kind)
      || typeof row.origin_node_id !== 'string' || !UUID.test(row.origin_node_id)
      || typeof row.destination_node_id !== 'string' || !UUID.test(row.destination_node_id)
      || typeof row.cost !== 'number' || !Number.isSafeInteger(row.cost) || row.cost < 0) {
      throw new Combat2DepartureError('error', 'combat2_depart returned an invalid success response');
    }
    const common = { originNodeId: row.origin_node_id, destinationNodeId: row.destination_node_id, cost: row.cost };
    if (row.kind === 'dead') return { status: 'dead', classification: 'dead', ...common };
    if (row.kind === 'queued' || row.kind === 'already_queued') return { status: 'queued', classification: row.kind, ...common };
    return { status: 'moved', classification: row.kind as 'moved' | 'already_moved', ...common };
  }
  return { status: 'refused', classification: row.kind, reason: typeof row.reason === 'string' ? row.reason : null };
}

export function createCombat2DepartureAdapter(client: { rpc(name: 'combat2_depart', args: Record<string, string>): PromiseLike<{ data: unknown; error: { message?: string } | null }> }): Combat2DepartureAdapter {
  return { async depart(characterId, destinationNodeId, requestId) {
    let response;
    try { response = await client.rpc('combat2_depart', { _character_id: characterId, _destination_node_id: destinationNodeId, _request_id: requestId }); }
    catch (error) { throw new Combat2DepartureError('uncertain', error instanceof Error ? error.message : 'combat2_depart transport failed'); }
    if (response.error) throw new Combat2DepartureError('uncertain', response.error.message ?? 'combat2_depart transport failed');
    return decodeCombat2Departure(response.data);
  }};
}
