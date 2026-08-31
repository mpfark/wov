import { describe, expect, it, vi } from 'vitest';
import { Combat2DeliveryAdapter, type Combat2DeliveryClient, type Combat2RealtimeChannel } from './delivery';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';

function result(ticks: number[], latest = ticks.at(-1) ?? 0, hasMore = false) {
  return {
    ok: true as const, kind: 'sync' as const, latest_tick: latest,
    returned_through_tick: ticks.at(-1) ?? latest, has_more: hasMore,
    encounter: { id: ENCOUNTER, status: 'active', tick: latest, stateVersion: latest },
    character: { hp: 10 }, fighter: { present: true }, creatures: [], effects: [], rewardClaims: [],
    batches: ticks.map((tick) => ({ id: `batch-${tick}`, tick, createdAt: '2026-08-31T00:00:00Z', events: [] })),
  };
}

function harness(responses: ReturnType<typeof result>[]) {
  let notice: ((payload: { new?: unknown }) => void) | undefined;
  let status: ((value: string) => void) | undefined;
  const channel: Combat2RealtimeChannel = {
    on: vi.fn((_type, _filter, callback) => { notice = callback; return channel; }),
    subscribe: vi.fn((callback) => { status = callback; return channel; }),
  };
  const rpc = vi.fn(async () => ({ data: responses.shift(), error: null }));
  const removeChannel = vi.fn();
  const client: Combat2DeliveryClient = { rpc, channel: vi.fn(() => channel), removeChannel };
  return { client, rpc, channel, removeChannel, notify: (tick: number) => notice?.({ new: { encounter_id: ENCOUNTER, tick, batch_id: `batch-${tick}` } }), reconnect: () => status?.('SUBSCRIBED') };
}

describe('Combat2DeliveryAdapter', () => {
  it('subscribes first and performs initial durable sync', async () => {
    const h = harness([result([])]);
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER });
    await adapter.start();
    expect(h.client.channel).toHaveBeenCalledOnce();
    expect(h.channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ table: 'combat2_tick_notification', filter: `encounter_id=eq.${ENCOUNTER}` }), expect.any(Function));
    expect(h.rpc).toHaveBeenCalledWith('combat2_sync', expect.objectContaining({ _after_tick: 0 }));
  });

  it('pages without gaps to the authoritative latest tick', async () => {
    const h = harness([result([1, 2], 3, true), result([3], 3, false)]);
    const seen = vi.fn();
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER, pageSize: 2, onSync: seen });
    const out = await adapter.start();
    expect(h.rpc.mock.calls.map((call) => call[1]._after_tick)).toEqual([0, 2]);
    expect(out.batches.map((batch) => batch.tick)).toEqual([1, 2, 3]);
    expect(adapter.lastAppliedTick).toBe(3);
    expect(seen).toHaveBeenCalledOnce();
  });

  it('fails closed instead of looping when pagination makes no progress', async () => {
    const stalled = { ...result([], 0, true), latest_tick: 2, encounter: { id: ENCOUNTER, status: 'active', tick: 2, stateVersion: 2 } };
    const h = harness([stalled]);
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER });
    await expect(adapter.start()).rejects.toThrow('no progress');
    expect(h.rpc).toHaveBeenCalledOnce();
  });

  it('recovers a skipped tick after a later notification', async () => {
    const h = harness([result([1], 1), result([2, 3], 3)]);
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER });
    await adapter.start();
    h.notify(3);
    await vi.waitFor(() => expect(adapter.lastAppliedTick).toBe(3));
    expect(h.rpc.mock.calls[1][1]._after_tick).toBe(1);
  });

  it('ignores duplicate and older notifications', async () => {
    const h = harness([result([1, 2], 2)]);
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER });
    await adapter.start();
    h.notify(2);
    h.notify(1);
    await Promise.resolve();
    expect(h.rpc).toHaveBeenCalledOnce();
  });

  it('synchronizes again on reconnect', async () => {
    const h = harness([result([1], 1), result([2], 2)]);
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER });
    await adapter.start();
    h.reconnect();
    await Promise.resolve();
    h.reconnect();
    await vi.waitFor(() => expect(adapter.lastAppliedTick).toBe(2));
  });

  it('removes the channel and performs no browser-driven mutation on stop', async () => {
    const h = harness([result([])]);
    const adapter = new Combat2DeliveryAdapter({ client: h.client, characterId: CHARACTER, encounterId: ENCOUNTER });
    await adapter.start();
    adapter.stop();
    expect(h.removeChannel).toHaveBeenCalledWith(h.channel);
    expect(h.rpc.mock.calls.every((call) => call[0] === 'combat2_sync')).toBe(true);
    await expect(adapter.requestSync()).rejects.toThrow('stopped');
  });
});
