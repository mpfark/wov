import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  buildCombat2DiagnosticExport, clearCombat2Recording, currentCombat2Recording,
  isCombat2RecordingFinished, recordCombat2ClientEvent, recoverableCombat2Recording,
  startCombat2Recording, startCombat2ServerRecording, stopCombat2Recording,
  stopCombat2ServerRecording,
} from './diagnostics';

const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>();
const channel = { on: () => channel, subscribe: () => channel, send: () => undefined };
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    channel: () => channel,
    removeChannel: () => undefined,
  },
}));
vi.mock('@/hooks/useBroadcastDebug', () => ({ useBroadcastDebug: () => ({ entries: [], clear: () => undefined }) }));

const OVERLAY_STATE = {
  status: 'idle', characterId: '11111111-1111-4111-8111-111111111111',
  nodeId: '22222222-2222-4222-8222-222222222222', encounterId: null,
  tick: null, cursor: null,
};

async function renderOpenOverlay() {
  const { default: BroadcastDebugOverlay } = await import('@/components/game/BroadcastDebugOverlay');
  render(<BroadcastDebugOverlay combat2={OVERLAY_STATE} />);
  fireEvent.click(screen.getByRole('button', { name: /Recording|idle|0/ }));
}

describe('Combat2 diagnostic Stop/Export recovery', () => {
  beforeEach(() => { sessionStorage.clear(); rpc.mockReset(); });
  afterEach(() => { cleanup(); sessionStorage.clear(); });

  it('reads the active recording without writing, so no render-phase update can loop', () => {
    startCombat2Recording('character', 'node', 'encounter', 1000, 'session');
    stopCombat2Recording();
    const changes = vi.fn();
    window.addEventListener('combat2-diagnostic-change', changes);
    expect(currentCombat2Recording()).toBeNull();
    expect(currentCombat2Recording()).toBeNull();
    window.removeEventListener('combat2-diagnostic-change', changes);
    expect(changes).not.toHaveBeenCalled();
  });

  it('retains a stopped recording so reload and export still recover the client buffer', () => {
    startCombat2Recording('character', 'node', 'encounter', Date.now(), 'session');
    recordCombat2ClientEvent({ event: 'action_clicked', requestId: 'request' });
    stopCombat2Recording();
    const retained = recoverableCombat2Recording();
    expect(retained?.sessionId).toBe('session');
    expect(retained?.events).toHaveLength(1);
    expect(isCombat2RecordingFinished(retained!)).toBe(true);
    expect(buildCombat2DiagnosticExport(retained!).clientEvents).toHaveLength(1);
    clearCombat2Recording();
    expect(recoverableCombat2Recording()).toBeNull();
  });

  it('recovers an expired recording after reload too', () => {
    startCombat2Recording('character', 'node', 'encounter', 1000, 'expired');
    expect(currentCombat2Recording()).toBeNull();
    expect(recoverableCombat2Recording()?.sessionId).toBe('expired');
  });

  it('is idempotent and fences a late stop for an older session', async () => {
    startCombat2Recording('character', 'node', 'encounter', Date.now(), 'first');
    const stopped = stopCombat2Recording();
    expect(stopCombat2Recording()).toEqual(stopped);
    expect(stopCombat2Recording('other-session')).toBeNull();
    expect(recoverableCombat2Recording()?.expiresAt).toBe(stopped?.expiresAt);
    rpc.mockResolvedValue({ data: { ok: true, kind: 'stopped' }, error: null });
    const { supabase } = await import('@/integrations/supabase/client');
    expect(await stopCombat2ServerRecording(supabase as never, 'stale')).toBeNull();
    expect(recoverableCombat2Recording()?.expiresAt).toBe(stopped?.expiresAt);
  });

  it('refuses to start a new recording over an unrecovered stopped one', async () => {
    startCombat2Recording('character', 'node', 'encounter', Date.now(), 'unexported');
    const { supabase } = await import('@/integrations/supabase/client');
    stopCombat2Recording();
    await expect(startCombat2ServerRecording(supabase as never, 'character', 'node', null)).rejects.toThrow(/unexported/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(recoverableCombat2Recording()?.sessionId).toBe('unexported');
  });

  it('stops once per click and never crashes the overlay on Stop', async () => {
    rpc.mockImplementation(async (name) => name === 'combat2_diagnostic_start'
      ? { data: { ok: true, kind: 'started', session_id: 'session' }, error: null }
      : { data: { ok: true, kind: 'stopped' }, error: null });
    await renderOpenOverlay();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start/ })); });
    await waitFor(() => expect(screen.getByRole('button', { name: /Stop/ })).toBeEnabled());
    const stop = screen.getByRole('button', { name: /Stop/ });
    await act(async () => { fireEvent.click(stop); fireEvent.click(stop); fireEvent.click(stop); });
    expect(rpc.mock.calls.filter(([name]) => name === 'combat2_diagnostic_stop')).toHaveLength(1);
    expect(screen.getByText(/Stopped recording retained/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/ })).toBeEnabled();
  });

  it('reports a recoverable message and keeps the client buffer when server export fails', async () => {
    startCombat2Recording('character', OVERLAY_STATE.nodeId, null, Date.now(), 'session');
    recordCombat2ClientEvent({ event: 'action_clicked', requestId: 'request' });
    stopCombat2Recording();
    rpc.mockResolvedValue({ data: { ok: false, kind: 'refused' }, error: null });
    const createUrl = vi.fn(() => 'blob:local');
    URL.createObjectURL = createUrl as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as unknown as typeof URL.revokeObjectURL;
    await renderOpenOverlay();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Export/ })); });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/local client events only/i));
    expect(createUrl).toHaveBeenCalled();
    expect(recoverableCombat2Recording()?.events).toHaveLength(1);
  });

  it('keeps the committed client and server bounds unchanged', async () => {
    const module = await import('./diagnostics');
    expect(module.COMBAT2_DIAGNOSTIC_MAX_EVENTS).toBe(500);
    expect(module.COMBAT2_DIAGNOSTIC_DURATION_MS).toBe(5 * 60_000);
  });
});
