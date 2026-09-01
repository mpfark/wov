import { readFileSync } from 'node:fs';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combat2DeliveryError, type Combat2DeliveryOptions, type Combat2SyncResult } from './delivery';
import {
  useCombat2DeliverySession,
  type Combat2DeliveryController,
  type Combat2DeliveryControllerFactory,
} from './useCombat2DeliverySession';

const CHARACTER = 'aaaaaaaa-0000-4000-8000-000000000001';
const ENCOUNTER = 'bbbbbbbb-0000-4000-8000-000000000001';
const ENCOUNTER_2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const unusedClient = { rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() } as never;

function sync(ticks: number[], encounterId = ENCOUNTER): Combat2SyncResult {
  const latest = ticks.at(-1) ?? 0;
  return {
    ok: true, kind: 'sync', latest_tick: latest, returned_through_tick: latest, has_more: false,
    encounter: { id: encounterId, status: 'active', tick: latest, stateVersion: latest },
    character: { hp: 10 }, fighter: { present: true }, creatures: [], effects: [], rewardClaims: [],
    batches: ticks.map((tick) => ({ id: `${encounterId}-${tick}`, tick, createdAt: '2026-09-01T00:00:00Z', events: [] })),
  };
}

function controllers() {
  const options: Combat2DeliveryOptions[] = [];
  const instances: Array<Combat2DeliveryController & { stop: ReturnType<typeof vi.fn> }> = [];
  const factory: Combat2DeliveryControllerFactory = vi.fn((value) => {
    options.push(value);
    const controller = { lastAppliedTick: 0, start: vi.fn(async () => sync([])), stop: vi.fn() };
    instances.push(controller);
    return controller;
  });
  return { factory, options, instances };
}

describe('useCombat2DeliverySession dormant integration', () => {
  it.each([
    { enabled: false, characterId: CHARACTER, encounterId: ENCOUNTER, status: 'disabled' },
    { enabled: true, characterId: null, encounterId: ENCOUNTER, status: 'idle' },
    { enabled: true, characterId: CHARACTER, encounterId: null, status: 'idle' },
  ] as const)('performs zero work for $status inputs', ({ status, ...inputs }) => {
    const c = controllers();
    const { result } = renderHook(() => useCombat2DeliverySession({ ...inputs, client: unusedClient, createController: c.factory }));
    expect(result.current.status).toBe(status);
    expect(c.factory).not.toHaveBeenCalled();
  });

  it('is mounted by the application with no legacy-derived encounter id', () => {
    const route = readFileSync('src/pages/GameRoute.tsx', 'utf8');
    expect(route).toContain('useCombat2DeliverySession({');
    expect(route).toMatch(/characterId:\s*character\?\.id \?\? null/);
    expect(route).toMatch(/encounterId:\s*null/);
    expect(route).not.toMatch(/\.rpc\(['"]combat_enter['"]/);
  });

  it('contains no browser timer, write, worker, action, or legacy-combat call path', () => {
    const source = [
      readFileSync('src/features/combat2/delivery.ts', 'utf8'),
      readFileSync('src/features/combat2/useCombat2DeliverySession.ts', 'utf8'),
      readFileSync('src/pages/GameRoute.tsx', 'utf8'),
    ].join('\n');
    expect(source).not.toMatch(/setInterval|setTimeout/);
    expect(source).not.toMatch(/\.rpc\(['"](?:combat_enter|combat_intent|combat_flee|node_tick_claim|node_tick_commit)/);
    expect(source).not.toMatch(/\.from\([^)]*\)\.(?:insert|update|delete|upsert)\(/);
    expect(source).not.toContain('combat2-tick-once');
    expect(source).not.toContain('combat2-dispatch-once');
  });
});

describe('useCombat2DeliverySession active lifecycle', () => {
  it('exposes authoritative snapshots and ordered, deduplicated batches', async () => {
    const c = controllers();
    const { result } = renderHook(() => useCombat2DeliverySession({ enabled: true, characterId: CHARACTER, encounterId: ENCOUNTER, client: unusedClient, createController: c.factory }));
    await waitFor(() => expect(c.options).toHaveLength(1));
    act(() => c.options[0].onSync?.(sync([1, 2])));
    act(() => c.options[0].onSync?.(sync([2, 3])));
    expect(result.current.status).toBe('live');
    expect(result.current.lastAppliedTick).toBe(3);
    expect(result.current.batches.map((batch) => batch.tick)).toEqual([1, 2, 3]);
    expect(result.current.snapshot?.encounter.id).toBe(ENCOUNTER);
  });

  it('unsubscribes and resets safely when the encounter changes', async () => {
    const c = controllers();
    const { result, rerender } = renderHook(({ encounterId }) => useCombat2DeliverySession({ enabled: true, characterId: CHARACTER, encounterId, client: unusedClient, createController: c.factory }), { initialProps: { encounterId: ENCOUNTER } });
    await waitFor(() => expect(c.instances).toHaveLength(1));
    act(() => c.options[0].onSync?.(sync([1])));
    rerender({ encounterId: ENCOUNTER_2 });
    await waitFor(() => expect(c.instances).toHaveLength(2));
    expect(c.instances[0].stop).toHaveBeenCalledOnce();
    expect(result.current.lastAppliedTick).toBe(0);
    act(() => c.options[0].onSync?.(sync([2])));
    expect(result.current.snapshot).toBeNull();
  });

  it('stops on logout/unmount and ignores late results', async () => {
    const c = controllers();
    const { result, rerender, unmount } = renderHook(({ characterId }) => useCombat2DeliverySession({ enabled: true, characterId, encounterId: ENCOUNTER, client: unusedClient, createController: c.factory }), { initialProps: { characterId: CHARACTER as string | null } });
    await waitFor(() => expect(c.instances).toHaveLength(1));
    rerender({ characterId: null });
    expect(result.current.status).toBe('idle');
    expect(c.instances[0].stop).toHaveBeenCalledOnce();
    act(() => c.options[0].onSync?.(sync([1])));
    expect(result.current.snapshot).toBeNull();
    unmount();
  });

  it.each([
    [new Combat2DeliveryError('refused', 'unauthorized'), 'refused'],
    [new Combat2DeliveryError('gap', 'gap detected'), 'gap'],
    [new Combat2DeliveryError('error', 'transport failed'), 'error'],
  ] as const)('surfaces %s without retry loops', async (failure, status) => {
    const factory: Combat2DeliveryControllerFactory = vi.fn((options) => ({
      lastAppliedTick: 0,
      start: vi.fn(async () => { options.onError?.(failure); throw failure; }),
      stop: vi.fn(),
    }));
    const { result } = renderHook(() => useCombat2DeliverySession({ enabled: true, characterId: CHARACTER, encounterId: ENCOUNTER, client: unusedClient, createController: factory }));
    await waitFor(() => expect(result.current.status).toBe(status));
    expect(factory).toHaveBeenCalledOnce();
  });
});
