import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { useServerWaymark } from './useServerWaymark';

const response = (node: string | null = 'origin', character = 'character') => ({ data: { ok: true, character_id: character, node_id: node, expires_at: new Date(Date.now() + 1200000).toISOString() }, error: null });
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('recovers only current server state on remount, including repeated return/node changes', async () => {
  const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(response() as never);
  const h = renderHook(({ node }) => useServerWaymark('account', 'character', node), { initialProps: { node: 'city' } });
  await act(async () => {}); expect(h.result.current.waymarkNodeId).toBe('origin');
  h.rerender({ node: 'origin' }); await act(async () => {}); expect(h.result.current.waymarkNodeId).toBe('origin');
  h.unmount(); const next = renderHook(() => useServerWaymark('account', 'character', 'origin'));
  await act(async () => {}); expect(next.result.current.waymarkNodeId).toBe('origin');
  expect(rpc.mock.calls.every(([, p]) => (p as any)._touch === false)).toBe(true);
});
it('no polling or mount activity: only visible input touches a live mark, throttled to five seconds', async () => {
  const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(response() as never);
  renderHook(() => useServerWaymark('account', 'character', 'city')); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); }); expect(rpc).toHaveBeenCalledTimes(1);
  await act(async () => { window.dispatchEvent(new Event('keydown')); window.dispatchEvent(new Event('mousemove')); });
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1][1]).toEqual({ _character_id: 'character', _touch: true });
  Object.defineProperty(document, 'visibilityState', { value: 'hidden' });
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); window.dispatchEvent(new Event('keydown')); }); expect(rpc).toHaveBeenCalledTimes(2);
});
it('expires presentation and cannot revive an expired server mark through input', async () => {
  const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue(response() as never);
  const h = renderHook(() => useServerWaymark('account', 'character', 'city')); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(1200000); }); expect(h.result.current.waymarkNodeId).toBeNull();
  await act(async () => { window.dispatchEvent(new Event('keydown')); }); expect(rpc).toHaveBeenCalledTimes(1);
});
it('drops out-of-order and previous-character replies; logout session refusal hides the mark', async () => {
  const resolvers: Array<(v: any) => void> = [];
  vi.spyOn(supabase, 'rpc').mockImplementation((() => new Promise(r => resolvers.push(r))) as unknown as typeof supabase.rpc);
  const h = renderHook(({ account, character }) => useServerWaymark(account, character, 'city'), { initialProps: { account: 'account', character: 'character' } });
  h.rerender({ account: 'other', character: 'other-character' });
  await act(async () => { resolvers[1](response('other-origin', 'other-character')); });
  await act(async () => { resolvers[0](response()); }); expect(h.result.current.waymarkNodeId).toBe('other-origin');
  let refresh!: Promise<void>; act(() => { refresh = h.result.current.refreshWaymark(); });
  await act(async () => { resolvers[2]({ data: { ok: false, kind: 'session_unavailable' }, error: null }); await refresh; });
  expect(h.result.current.waymarkNodeId).toBeNull();
});
it('network/mismatched responses never establish a waymark', async () => {
  vi.spyOn(supabase, 'rpc').mockResolvedValue(response('wrong', 'someone-else') as never);
  const h = renderHook(() => useServerWaymark('account', 'character', 'city')); await act(async () => {});
  expect(h.result.current.waymarkNodeId).toBeNull();
});
