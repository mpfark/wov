import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Combat2DepartureError, type Combat2DepartureAdapter } from './departure';
import { useCombat2DepartureSession } from './useCombat2DepartureSession';

const C = 'aaaaaaaa-0000-4000-8000-000000000001';
const A = 'aaaaaaaa-0000-4000-8000-000000000002';
const B = 'aaaaaaaa-0000-4000-8000-000000000003';
const R = 'aaaaaaaa-0000-4000-8000-000000000004';
const queued = { status: 'queued', classification: 'queued', originNodeId: A, destinationNodeId: B, cost: 5 } as const;
const moved = { status: 'moved', classification: 'moved', originNodeId: A, destinationNodeId: B, cost: 5 } as const;

describe('useCombat2DepartureSession', () => {
  it('queues once and blocks duplicate movement', async () => {
    const adapter: Combat2DepartureAdapter = { depart: vi.fn().mockResolvedValue(queued),state:vi.fn().mockResolvedValue({status:'none'}) };
    const { result } = renderHook(() => useCombat2DepartureSession({ enabled: true, canSubmit: true, characterId: C, nodeId: A, adapter, generateRequestId: () => R }));
    await act(async()=>{await Promise.resolve();});
    await act(async () => { expect(await result.current.move(B)).toMatchObject({ status: 'queued' }); });
    await expect(result.current.move(B)).resolves.toMatchObject({ status: 'local_refusal', classification: 'exit_pending' });
    expect(adapter.depart).toHaveBeenCalledOnce();
  });

  it('projects the committed destination before clearing the input fence', async () => {
    const adapter: Combat2DepartureAdapter = { depart: vi.fn().mockResolvedValue(moved),state:vi.fn().mockResolvedValue({status:'none'}) };
    const order:string[]=[];
    const onMoved=vi.fn(()=>order.push('projected'));
    const { result } = renderHook(() => useCombat2DepartureSession({ enabled: true, canSubmit: true, characterId: C, nodeId: A, adapter, generateRequestId: () => R,onMoved }));
    await act(async()=>{await Promise.resolve();});
    await act(async () => { const response=await result.current.move(B);order.push('returned');expect(response).toMatchObject({ status: 'moved' }); });
    expect(onMoved).toHaveBeenCalledExactlyOnceWith({originNodeId:A,destinationNodeId:B});
    expect(order).toEqual(['projected','returned']);
    expect(result.current.pending).toBe(false);
  });

  it('allows an immediate next move from the reconciled destination without waiting for realtime',async()=>{
    const C2='aaaaaaaa-0000-4000-8000-000000000005';
    const adapter:Combat2DepartureAdapter={depart:vi.fn().mockResolvedValueOnce(moved).mockResolvedValueOnce({...moved,originNodeId:B,destinationNodeId:C2}),state:vi.fn().mockResolvedValue({status:'moved',requestId:R,originNodeId:A,destinationNodeId:B})};
    let nodeId=A;
    const onMoved=vi.fn((movement:{destinationNodeId:string})=>{nodeId=movement.destinationNodeId;});
    const {result,rerender}=renderHook(({node})=>useCombat2DepartureSession({enabled:true,canSubmit:true,characterId:C,nodeId:node,adapter,generateRequestId:()=>crypto.randomUUID(),onMoved}),{initialProps:{node:A}});
    await act(async()=>{await Promise.resolve();});
    await act(async()=>{await result.current.move(B);});
    rerender({node:nodeId});
    expect(result.current.pending).toBe(false);
    await act(async()=>{expect(await result.current.move(C2)).toMatchObject({status:'moved',originNodeId:B,destinationNodeId:C2});});
    expect(adapter.depart).toHaveBeenCalledTimes(2);
  });

  it('retries an uncertain response with the same request id and drops stale responses', async () => {
    let release!: (value: typeof queued) => void;
    const adapter: Combat2DepartureAdapter = { state:vi.fn().mockResolvedValue({status:'none'}),depart: vi.fn()
      .mockRejectedValueOnce(new Combat2DepartureError('uncertain', 'offline'))
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; })) };
    const onMoved=vi.fn();
    const { result, rerender } = renderHook(({ nodeId }) => useCombat2DepartureSession({ enabled: true, canSubmit: true, characterId: C, nodeId, adapter, generateRequestId: () => R,onMoved }), { initialProps: { nodeId: A } });
    await act(async()=>{await Promise.resolve();});
    await act(async () => { expect(await result.current.move(B)).toMatchObject({ status: 'uncertain' }); });
    let retried!: Promise<unknown>;
    act(() => { retried = result.current.retry(); });
    rerender({ nodeId: B });
    await act(async () => { release(queued); expect(await retried).toMatchObject({ status: 'stale' }); });
    expect(adapter.depart).toHaveBeenNthCalledWith(1, C, B, R);
    expect(adapter.depart).toHaveBeenNthCalledWith(2, C, B, R);
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('discards late state recovery after a character switch',async()=>{
    const releases:Array<(value:{status:'moved';requestId:string;originNodeId:string;destinationNodeId:string})=>void>=[];
    const adapter:Combat2DepartureAdapter={depart:vi.fn(),state:vi.fn().mockImplementation(()=>new Promise(resolve=>{releases.push(resolve);}))};
    const onMoved=vi.fn();
    const {rerender}=renderHook(({characterId})=>useCombat2DepartureSession({enabled:true,canSubmit:true,characterId,nodeId:A,adapter,onMoved}),{initialProps:{characterId:C}});
    rerender({characterId:'aaaaaaaa-0000-4000-8000-000000000006'});
    await act(async()=>{releases[0]({status:'moved',requestId:R,originNodeId:A,destinationNodeId:B});await Promise.resolve();});
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('reconstructs a queued departure on refresh and clears only after authoritative terminal state',async()=>{
    vi.useFakeTimers();
    const state=vi.fn().mockResolvedValueOnce({status:'queued',requestId:R,originNodeId:A,destinationNodeId:B}).mockResolvedValueOnce({status:'moved',requestId:R,originNodeId:A,destinationNodeId:B});
    const adapter:Combat2DepartureAdapter={state,depart:vi.fn()};
    const {result}=renderHook(()=>useCombat2DepartureSession({enabled:true,canSubmit:true,characterId:C,nodeId:A,adapter}));
    await act(async()=>{await Promise.resolve();});expect(result.current.pending).toBe(true);
    await act(async()=>{vi.advanceTimersByTime(2000);await Promise.resolve();});expect(result.current.pending).toBe(false);
    expect(adapter.depart).not.toHaveBeenCalled();vi.useRealTimers();
  });

  it('projects a recovered terminal move when realtime delivery is missing',async()=>{
    vi.useFakeTimers();
    const onMoved=vi.fn();
    const state=vi.fn().mockResolvedValueOnce({status:'queued',requestId:R,originNodeId:A,destinationNodeId:B}).mockResolvedValueOnce({status:'moved',requestId:R,originNodeId:A,destinationNodeId:B});
    const adapter:Combat2DepartureAdapter={state,depart:vi.fn()};
    const {result}=renderHook(()=>useCombat2DepartureSession({enabled:true,canSubmit:true,characterId:C,nodeId:A,adapter,onMoved}));
    await act(async()=>{await Promise.resolve();});
    await act(async()=>{vi.advanceTimersByTime(2000);await Promise.resolve();});
    expect(onMoved).toHaveBeenCalledExactlyOnceWith({originNodeId:A,destinationNodeId:B});
    expect(result.current.pending).toBe(false);
    vi.useRealTimers();
  });
});
