import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combat2DepartureError, type Combat2DepartureAdapter } from './departure';
import { useCombat2DepartureSession } from './useCombat2DepartureSession';

const C = 'aaaaaaaa-0000-4000-8000-000000000001';
const A = 'aaaaaaaa-0000-4000-8000-000000000002';
const B = 'aaaaaaaa-0000-4000-8000-000000000003';
const R = 'aaaaaaaa-0000-4000-8000-000000000004';
const queued = { status: 'queued', classification: 'queued', originNodeId: A, destinationNodeId: B, cost: 5 } as const;

describe('useCombat2DepartureSession', () => {
  it('queues once and blocks duplicate movement', async () => {
    const adapter: Combat2DepartureAdapter = { depart: vi.fn().mockResolvedValue(queued) };
    const { result } = renderHook(() => useCombat2DepartureSession({ enabled: true, canSubmit: true, characterId: C, nodeId: A, adapter, generateRequestId: () => R }));
    await act(async () => { expect(await result.current.move(B)).toMatchObject({ status: 'queued' }); });
    await expect(result.current.move(B)).resolves.toMatchObject({ status: 'local_refusal', classification: 'exit_pending' });
    expect(adapter.depart).toHaveBeenCalledOnce();
  });

  it('retries an uncertain response with the same request id and drops stale responses', async () => {
    let release!: (value: typeof queued) => void;
    const adapter: Combat2DepartureAdapter = { depart: vi.fn()
      .mockRejectedValueOnce(new Combat2DepartureError('uncertain', 'offline'))
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; })) };
    const { result, rerender } = renderHook(({ nodeId }) => useCombat2DepartureSession({ enabled: true, canSubmit: true, characterId: C, nodeId, adapter, generateRequestId: () => R }), { initialProps: { nodeId: A } });
    await act(async () => { expect(await result.current.move(B)).toMatchObject({ status: 'uncertain' }); });
    let retried!: Promise<unknown>;
    act(() => { retried = result.current.retry(); });
    rerender({ nodeId: B });
    await act(async () => { release(queued); expect(await retried).toMatchObject({ status: 'stale' }); });
    expect(adapter.depart).toHaveBeenNthCalledWith(1, C, B, R);
    expect(adapter.depart).toHaveBeenNthCalledWith(2, C, B, R);
  });
});
