import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Combat2DepartureError, createCombat2DepartureAdapter, type Combat2DepartureAdapter, type Combat2DepartureOutcome } from './departure';

export type Combat2DepartureResult = Combat2DepartureOutcome | { status: 'local_refusal' | 'stale' | 'uncertain' | 'error'; classification?: string; reason: string };

export function useCombat2DepartureSession(options: {
  enabled: boolean; canSubmit: boolean; characterId: string | null; nodeId: string | null;
  adapter?: Combat2DepartureAdapter; generateRequestId?: () => string; onQueued?(): void;
}) {
  const adapter = options.adapter ?? createCombat2DepartureAdapter({ rpc: (name, args) => supabase.rpc(name as never, args as never) });
  const generate = options.generateRequestId ?? (() => crypto.randomUUID());
  const key = options.enabled && options.characterId && options.nodeId ? `${options.characterId}:${options.nodeId}` : null;
  const keyRef = useRef(key); keyRef.current = key;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const attempt = useRef<{ key: string; destination: string; requestId: string; inFlight: boolean; uncertain: boolean } | null>(null);
  useEffect(() => { attempt.current = null; pendingRef.current = false; setPending(false); }, [key]);
  const run = useCallback(async (current: { key: string; destination: string; requestId: string; inFlight: boolean; uncertain: boolean }): Promise<Combat2DepartureResult> => {
    if (!options.canSubmit || !key || !options.characterId) return { status: 'local_refusal', classification: 'no_session', reason: 'Combat2 movement is not ready' };
    if (current.inFlight) return { status: 'local_refusal', classification: 'exit_pending', reason: 'Combat2 departure is already pending' };
    current.inFlight = true;
    try {
      const result = await adapter.depart(options.characterId, current.destination, current.requestId);
      if (keyRef.current !== current.key) return { status: 'stale', reason: 'Combat2 movement response is stale' };
      current.inFlight = false; current.uncertain = false;
      if (result.status === 'queued' || result.status === 'moved' || result.status === 'dead') {
        pendingRef.current = true; setPending(true);
        if (result.status === 'queued') options.onQueued?.();
      } else { pendingRef.current = false; setPending(false); }
      return result;
    } catch (error) {
      current.inFlight = false; current.uncertain = error instanceof Combat2DepartureError && error.code === 'uncertain';
      pendingRef.current = false; setPending(false);
      return { status: current.uncertain ? 'uncertain' : 'error', reason: error instanceof Error ? error.message : 'combat2_depart failed' };
    }
  }, [adapter, key, options.canSubmit, options.characterId, options.onQueued]);
  const move = useCallback((destination: string): Promise<Combat2DepartureResult> => {
    if (!key) return Promise.resolve({ status: 'local_refusal', classification: 'no_session', reason: 'Combat2 movement is not ready' });
    if (attempt.current?.inFlight || pendingRef.current) return Promise.resolve({ status: 'local_refusal', classification: 'exit_pending', reason: 'Combat2 departure is already pending' });
    const current = { key, destination, requestId: generate(), inFlight: false, uncertain: false }; attempt.current = current;
    pendingRef.current = true; setPending(true);
    return run(current);
  }, [generate, key, run]);
  const retry = useCallback((): Promise<Combat2DepartureResult> => {
    if (!attempt.current?.uncertain) return Promise.resolve({ status: 'local_refusal', classification: 'no_retry', reason: 'No uncertain Combat2 movement can be retried' });
    return run(attempt.current);
  }, [run]);
  return { move, retry, pending };
}
