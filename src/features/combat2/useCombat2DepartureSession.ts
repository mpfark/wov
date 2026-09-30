import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Combat2DepartureError,
  createCombat2DepartureAdapter,
  type Combat2DepartureAdapter,
  type Combat2DepartureMemberOutcome,
  type Combat2DepartureOutcome,
} from './departure';

export type Combat2DepartureResult = Combat2DepartureOutcome | {
  status: 'local_refusal' | 'stale' | 'uncertain' | 'error';
  classification?: string;
  reason: string;
};

const defaultDepartureAdapter = createCombat2DepartureAdapter({
  rpc: (name, args) => supabase.rpc(name as never, args as never),
});

type Attempt = {
  key: string;
  destination: string;
  requestId: string;
  inFlight: boolean;
  uncertain: boolean;
};

export function useCombat2DepartureSession(options: {
  enabled: boolean;
  canSubmit: boolean;
  characterId: string | null;
  nodeId: string | null;
  adapter?: Combat2DepartureAdapter;
  generateRequestId?: () => string;
  onQueued?(): void;
  onMoved?(movement: {
    originNodeId: string;
    destinationNodeId: string;
    members?: Combat2DepartureMemberOutcome[];
  }): void;
}) {
  const adapter = options.adapter ?? defaultDepartureAdapter;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const generate = options.generateRequestId ?? (() => crypto.randomUUID());
  const key = options.enabled && options.characterId && options.nodeId
    ? `${options.characterId}:${options.nodeId}`
    : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [recovering, setRecovering] = useState(!!key);
  const recoveringRef = useRef(!!key);
  const stateGeneration = useRef(0);
  const reconciledKeyRef = useRef<string | null>(null);
  const attempt = useRef<Attempt | null>(null);

  const setLifecycle = useCallback((next: { pending: boolean; recovering: boolean }) => {
    pendingRef.current = next.pending;
    recoveringRef.current = next.recovering;
    setPending(next.pending);
    setRecovering(next.recovering);
  }, []);

  useEffect(() => {
    const generation = ++stateGeneration.current;
    attempt.current = null;
    const alreadyReconciled = reconciledKeyRef.current === key;
    if (alreadyReconciled) reconciledKeyRef.current = null;
    setLifecycle({ pending: false, recovering: !!key && !alreadyReconciled });
    if (!key || !options.characterId || alreadyReconciled) return;
    let active = true;
    void adapterRef.current.state(options.characterId).then(state => {
      if (!active || generation !== stateGeneration.current || keyRef.current !== key) return;
      setLifecycle({ pending: state.status === 'queued', recovering: false });
    }).catch(() => {
      // A recovery read failure stays fail-closed, but is not a pending move.
    });
    return () => { active = false; };
  }, [key, options.characterId, setLifecycle]);

  useEffect(() => {
    if (!pending || !key || !options.characterId) return;
    const generation = stateGeneration.current;
    let active = true;
    const timer = window.setInterval(() => {
      void adapterRef.current.state(options.characterId!).then(state => {
        if (!active || generation !== stateGeneration.current || keyRef.current !== key) return;
        if (state.status === 'queued') return;
        if (state.status === 'moved' && state.originNodeId && state.destinationNodeId) {
          reconciledKeyRef.current = `${options.characterId}:${state.destinationNodeId}`;
          options.onMoved?.({
            originNodeId: state.originNodeId,
            destinationNodeId: state.destinationNodeId,
          });
        }
        setLifecycle({ pending: false, recovering: false });
      }).catch(() => {});
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [key, options.characterId, options.onMoved, pending, setLifecycle]);

  const run = useCallback(async (current: Attempt): Promise<Combat2DepartureResult> => {
    if (!options.canSubmit || !key || !options.characterId || recoveringRef.current) {
      return { status: 'local_refusal', classification: 'no_session', reason: 'Combat2 movement is not ready' };
    }
    if (current.inFlight) {
      return { status: 'local_refusal', classification: 'exit_pending', reason: 'Combat2 departure is already pending' };
    }
    current.inFlight = true;
    try {
      const result = await adapterRef.current.depart(options.characterId, current.destination, current.requestId);
      if (keyRef.current !== current.key) {
        return { status: 'stale', reason: 'Combat2 movement response is stale' };
      }
      current.inFlight = false;
      current.uncertain = false;
      if (result.status === 'queued') {
        setLifecycle({ pending: true, recovering: false });
        options.onQueued?.();
      } else {
        if (result.status === 'moved') {
          reconciledKeyRef.current = `${options.characterId}:${result.destinationNodeId}`;
          options.onMoved?.({
            originNodeId: result.originNodeId,
            destinationNodeId: result.destinationNodeId,
            members: result.members,
          });
        }
        setLifecycle({ pending: false, recovering: false });
      }
      return result;
    } catch (error) {
      current.inFlight = false;
      current.uncertain = error instanceof Combat2DepartureError && error.code === 'uncertain';
      setLifecycle({ pending: false, recovering: false });
      return {
        status: current.uncertain ? 'uncertain' : 'error',
        reason: error instanceof Error ? error.message : 'combat2_depart failed',
      };
    }
  }, [key, options.canSubmit, options.characterId, options.onMoved, options.onQueued, setLifecycle]);

  const move = useCallback((destination: string): Promise<Combat2DepartureResult> => {
    if (!options.canSubmit || !key || recoveringRef.current) {
      return Promise.resolve({ status: 'local_refusal', classification: 'no_session', reason: 'Combat2 movement is not ready' });
    }
    if (attempt.current?.inFlight || pendingRef.current) {
      return Promise.resolve({ status: 'local_refusal', classification: 'exit_pending', reason: 'Combat2 departure is already pending' });
    }
    stateGeneration.current += 1;
    const current = { key, destination, requestId: generate(), inFlight: false, uncertain: false };
    attempt.current = current;
    setLifecycle({ pending: true, recovering: false });
    return run(current);
  }, [generate, key, options.canSubmit, run, setLifecycle]);

  const retry = useCallback((): Promise<Combat2DepartureResult> => {
    if (!attempt.current?.uncertain) {
      return Promise.resolve({ status: 'local_refusal', classification: 'no_retry', reason: 'No uncertain Combat2 movement can be retried' });
    }
    return run(attempt.current);
  }, [run]);

  return { move, retry, pending, recovering };
}
