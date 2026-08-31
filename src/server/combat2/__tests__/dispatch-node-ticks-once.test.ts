import { describe, expect, it, vi } from 'vitest';
import { DISPATCH_LIMIT, dispatchNodeTicksOnce } from '../dispatch-node-ticks-once';
import type { NodeTickRunResult } from '../process-node-tick-once';

const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const candidate = (n: number) => ({ node_id: id(n), encounter_id: id(n + 100), next_due_at: `2026-08-31T00:00:${n.toString().padStart(2, '0')}Z` });
const discovery = (candidates: unknown[]) => ({ ok: true, kind: 'candidates', candidate_count: candidates.length, candidates });

describe('dispatchNodeTicksOnce', () => {
  it.each(['maintenance', 'world_asleep'] as const)('preserves %s discovery refusal', async (kind) => {
    const processNode = vi.fn();
    const out = await dispatchNodeTicksOnce({ discoverDueNodes: async () => ({ ok: false, kind }), processNode });
    expect(out).toMatchObject({ ok: false, classification: kind, candidateCount: 0, processedCount: 0 });
    expect(processNode).not.toHaveBeenCalled();
  });

  it('calls discovery once with the fixed limit and does no work for an empty batch', async () => {
    const discoverDueNodes = vi.fn(async () => discovery([]));
    const processNode = vi.fn();
    const out = await dispatchNodeTicksOnce({ discoverDueNodes, processNode });
    expect(discoverDueNodes).toHaveBeenCalledOnce();
    expect(discoverDueNodes).toHaveBeenCalledWith(DISPATCH_LIMIT);
    expect(processNode).not.toHaveBeenCalled();
    expect(out).toMatchObject({ candidateCount: 0, processedCount: 0, summary: {}, moreMayRemain: false });
  });

  it('processes candidates sequentially, once each, in discovery order', async () => {
    const active = { count: 0, max: 0 };
    const order: string[] = [];
    const processNode = vi.fn(async (nodeId: string): Promise<NodeTickRunResult> => {
      active.count += 1;
      active.max = Math.max(active.max, active.count);
      order.push(nodeId);
      await Promise.resolve();
      active.count -= 1;
      return { ok: true, kind: 'not_due', nextDueAt: null };
    });
    const rows = [candidate(3), candidate(1), candidate(2)];
    const out = await dispatchNodeTicksOnce({ discoverDueNodes: async () => discovery(rows), processNode });
    expect(order).toEqual(rows.map((row) => row.node_id));
    expect(active.max).toBe(1);
    expect(processNode).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ candidateCount: 3, processedCount: 3, summary: { not_due: 3 } });
  });

  it('continues after normal failure and unexpected exception without retrying', async () => {
    const processNode = vi.fn(async (nodeId: string): Promise<NodeTickRunResult> => {
      if (nodeId === id(1)) return { ok: false, kind: 'stale_snapshot', encounterId: id(101) };
      if (nodeId === id(2)) throw new Error('raw database secret');
      return { ok: true, kind: 'committed', encounterId: id(103), tick: 7 };
    });
    const out = await dispatchNodeTicksOnce({
      discoverDueNodes: async () => discovery([candidate(1), candidate(2), candidate(3)]),
      processNode,
    });
    expect(processNode).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({
      summary: { stale_snapshot: 1, worker_exception: 1, committed: 1 },
      results: [
        { nodeId: id(1), classification: 'stale_snapshot' },
        { nodeId: id(2), classification: 'worker_exception', reason: 'worker threw unexpectedly' },
        { nodeId: id(3), classification: 'committed', tick: 7 },
      ],
    });
    expect(JSON.stringify(out)).not.toContain('raw database secret');
  });

  it('caps a batch at ten and reports that more candidates may remain', async () => {
    const rows = Array.from({ length: DISPATCH_LIMIT }, (_, index) => candidate(index + 1));
    const processNode = vi.fn(async (): Promise<NodeTickRunResult> => ({ ok: true, kind: 'in_flight' }));
    const out = await dispatchNodeTicksOnce({ discoverDueNodes: async () => discovery(rows), processNode });
    expect(processNode).toHaveBeenCalledTimes(DISPATCH_LIMIT);
    expect(out.moreMayRemain).toBe(true);
  });

  it.each([
    discovery([candidate(1), candidate(1)]),
    discovery(Array.from({ length: DISPATCH_LIMIT + 1 }, (_, index) => candidate(index + 1))),
    discovery([{ node_id: 'not-a-uuid', encounter_id: id(1), next_due_at: 'bad' }]),
    { ok: true, kind: 'candidates', candidates: 'not-an-array' },
  ])('rejects malformed discovery without processing candidates', async (payload) => {
    const processNode = vi.fn();
    const out = await dispatchNodeTicksOnce({ discoverDueNodes: async () => payload, processNode });
    expect(out).toMatchObject({ ok: false, classification: 'discovery_failed' });
    expect(processNode).not.toHaveBeenCalled();
  });

  it('sanitizes worker diagnostic details in per-node results', async () => {
    const out = await dispatchNodeTicksOnce({
      discoverDueNodes: async () => discovery([candidate(1)]),
      processNode: async () => ({ ok: false, kind: 'claim_transport_error', diagnostic: 'raw error secret' }),
    });
    expect(out.results[0]).toEqual({ nodeId: id(1), classification: 'claim_transport_error', reason: 'worker failed safely' });
    expect(JSON.stringify(out)).not.toContain('raw error secret');
  });
});
