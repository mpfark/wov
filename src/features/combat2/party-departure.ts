import { Combat2DepartureError, createCombat2DepartureAdapter, type Combat2DepartureAdapter, type Combat2DepartureMemberOutcome } from './departure';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const members = (value:unknown):Combat2DepartureMemberOutcome[] => {
  if(!Array.isArray(value)) throw new Error('combat2_party_depart returned malformed members');
  return value.map(raw=>{if(!object(raw)||!UUID.test(String(raw.character_id))||typeof raw.display_name!=='string'||!Number.isSafeInteger(raw.order)||!Number.isSafeInteger(raw.cost)||!['waiting','queued','moved','dead','remaining'].includes(String(raw.status)))throw new Error('combat2_party_depart returned malformed members');return {characterId:String(raw.character_id),displayName:raw.display_name,order:raw.order as number,status:raw.status as Combat2DepartureMemberOutcome['status'],cost:raw.cost as number};});
};

/** Selects the coordinated RPC only for a real party leader with eligible followers. */
export function createPartyAwareDepartureAdapter(client: {
  rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}, coordinated: () => boolean): Combat2DepartureAdapter {
  const solo = createCombat2DepartureAdapter(client as never);
  return { async depart(characterId, destinationNodeId, requestId) {
    if (!coordinated()) return solo.depart(characterId, destinationNodeId, requestId);
    let response;
    try {
      response = await client.rpc('combat2_party_depart', {
        _leader_character_id: characterId, _destination_node_id: destinationNodeId, _request_id: requestId,
      });
    } catch { throw new Combat2DepartureError('uncertain', 'combat2_party_depart transport failed'); }
    if (response.error) throw new Combat2DepartureError('uncertain', 'combat2_party_depart transport failed');
    const row = object(response.data) ? response.data : null;
    if (!row || typeof row.ok !== 'boolean' || typeof row.kind !== 'string') throw new Error('combat2_party_depart returned a malformed response');
    if (!row.ok) return { status: 'refused', classification: row.kind, reason: typeof row.reason === 'string' ? row.reason : null };
    if (!UUID.test(String(row.origin_node_id)) || !UUID.test(String(row.destination_node_id)) || !Number.isSafeInteger(row.cost))
      throw new Error('combat2_party_depart returned an invalid success response');
    const common = { originNodeId: String(row.origin_node_id), destinationNodeId: String(row.destination_node_id), cost: row.cost as number, members:members(row.members) };
    if (row.kind === 'dead') return { status: 'dead', classification: 'dead', ...common };
    if (row.kind === 'queued' || row.kind === 'already_queued') return { status: 'queued', classification: row.kind, ...common };
    if (row.kind === 'moved' || row.kind === 'already_moved') return { status: 'moved', classification: row.kind, ...common };
    throw new Error('combat2_party_depart returned an unknown success classification');
  } };
}
