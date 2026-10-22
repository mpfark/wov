import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useTestTeleportRequest } from './useTestTeleportRequest';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeEach(() => sessionStorage.clear()); afterEach(cleanup);
const success = (p: any) => ({ data: { ...p, ok: true, outcome: 'committed' }, error: null });
it('persists before dispatch; remount requires explicit exact replay even with another selected destination', async () => {
  const calls: any[] = [];
  const first = renderHook(() => useTestTeleportRequest(id(1), id(2)));
  await act(async () => { await expect(first.result.current.submit(id(3), async p => {
    expect(sessionStorage.length).toBe(1); calls.push(p); throw Error('lost response');
  })).rejects.toThrow('lost response'); });
  first.unmount();
  const second = renderHook(() => useTestTeleportRequest(id(1), id(2)));
  expect(calls).toHaveLength(1); expect(second.result.current.pending).toEqual(calls[0]);
  await act(async () => { await second.result.current.submit(id(4), async p => { calls.push(p); return success(p); }); });
  expect(calls[1]).toEqual(calls[0]); expect(second.result.current.pending).toBeNull();
});
it('isolates accounts and characters', async () => {
  const first = renderHook(() => useTestTeleportRequest(id(1), id(2)));
  await act(async () => { await expect(first.result.current.submit(id(3), async () => { throw Error('timeout'); })).rejects.toThrow(); });
  expect(renderHook(() => useTestTeleportRequest(id(4), id(2))).result.current.pending).toBeNull();
  expect(renderHook(() => useTestTeleportRequest(id(1), id(4))).result.current.pending).toBeNull();
});
it('retains on ambiguous HTTP and mismatched outcomes; matching refusal permits a new UUID', async () => {
  const h = renderHook(() => useTestTeleportRequest(id(1), id(2))); let original: any;
  await act(async () => { await expect(h.result.current.submit(id(3), async p => {
    original = p; return { data: null, error: { context: new Response('{}', { status: 400 }) } };
  })).rejects.toThrow('uncertain'); });
  await act(async () => { await expect(h.result.current.submit(id(4), async p => ({ data: { ...p, request_id: id(99), outcome: 'not_committed' }, error: null }))).rejects.toThrow('uncertain'); });
  expect(h.result.current.pending).toEqual(original);
  await act(async () => { await expect(h.result.current.submit(null, async p => ({ data: { ...p, outcome: 'not_committed', error: 'combat' }, error: null }))).rejects.toThrow('combat'); });
  await act(async () => { await h.result.current.submit(id(4), async p => { expect(p.request_id).not.toBe(original.request_id); expect(p.destination_node_id).toBe(id(4)); return success(p); }); });
});
it('blocks competing clicks and corrupt recovery', async () => {
  const h = renderHook(() => useTestTeleportRequest(id(1), id(2))); let finish!: () => void; let calls = 0;
  const barrier = new Promise<void>(r => { finish = r; });
  await act(async () => {
    const pending = h.result.current.submit(id(3), async p => { calls++; await barrier; return success(p); });
    expect(await h.result.current.submit(id(4), async p => { calls++; return success(p); })).toBeNull();
    finish(); await pending;
  }); expect(calls).toBe(1);
  sessionStorage.setItem(`wov.test-teleport.v1:${id(1)}:${id(2)}`, '{broken');
  const bad = renderHook(() => useTestTeleportRequest(id(1), id(2)));
  expect(bad.result.current.recoveryError).toBeTruthy();
});
