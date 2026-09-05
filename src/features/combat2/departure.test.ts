import { describe, expect, it, vi } from 'vitest';
import { Combat2DepartureError, createCombat2DepartureAdapter, decodeCombat2Departure } from './departure';

const C = 'aaaaaaaa-0000-4000-8000-000000000001';
const A = 'aaaaaaaa-0000-4000-8000-000000000002';
const B = 'aaaaaaaa-0000-4000-8000-000000000003';
const R = 'aaaaaaaa-0000-4000-8000-000000000004';

describe('Combat2 departure adapter', () => {
  it.each(['moved', 'already_moved', 'queued', 'already_queued', 'dead'])('preserves %s', kind => {
    expect(decodeCombat2Departure({ ok: true, kind, origin_node_id: A, destination_node_id: B, cost: 5 })).toMatchObject({ classification: kind, originNodeId: A, destinationNodeId: B, cost: 5 });
  });
  it('does not infer success from malformed data', () => {
    expect(() => decodeCombat2Departure({ ok: true, kind: 'moved' })).toThrow(Combat2DepartureError);
  });
  it('sends only character, destination and stable request identity', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, kind: 'moved', origin_node_id: A, destination_node_id: B, cost: 5 }, error: null });
    await createCombat2DepartureAdapter({ rpc }).depart(C, B, R);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('combat2_depart', { _character_id: C, _destination_node_id: B, _request_id: R });
  });
});
