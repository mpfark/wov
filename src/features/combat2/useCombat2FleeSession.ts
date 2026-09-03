import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Combat2FleeError,
  createCombat2FleeAdapter,
  type Combat2FleeAdapter,
  type Combat2FleeClient,
  type Combat2FleeOutcome,
} from './flee';

export type Combat2FleeResult =
  | Combat2FleeOutcome
  | { status: 'local_refusal'; classification: 'disabled' | 'no_session' | 'in_flight' | 'no_retry'; reason: string }
  | { status: 'stale' }
  | { status: 'uncertain' | 'error'; reason: string };

interface Attempt {
  requestId: string;
  sessionKey: string;
  inFlight: boolean;
}

export interface UseCombat2FleeSessionOptions {
  canSubmit?: boolean;
  onQueued?(): void;
  enabled: boolean;
  characterId: string | null;
  nodeId: string | null;
  encounterId: string | null;
  adapter?: Combat2FleeAdapter;
  generateRequestId?: () => string;
  onExited(sessionKey: string): void;
}

export interface Combat2FleeSession {
  flee(): Promise<Combat2FleeResult>;
  retry(): Promise<Combat2FleeResult>;
}

const defaultAdapter = createCombat2FleeAdapter({
  rpc: (name, args) => supabase.rpc(name, args),
} satisfies Combat2FleeClient);

export function useCombat2FleeSession({
  canSubmit = true,
  onQueued,
  enabled,
  characterId,
  nodeId,
  encounterId,
  adapter = defaultAdapter,
  generateRequestId = () => crypto.randomUUID(),
  onExited,
}: UseCombat2FleeSessionOptions): Combat2FleeSession {
  const sessionKey = enabled && characterId && nodeId && encounterId
    ? `${characterId}:${nodeId}:${encounterId}`
    : null;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const readyRef = useRef(canSubmit);
  readyRef.current = canSubmit;
  const generationRef = useRef(0);
  const attemptRef = useRef<Attempt | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    attemptRef.current = null;
    return () => {
      generationRef.current += 1;
      attemptRef.current = null;
    };
  }, [sessionKey, canSubmit]);

  const run = useCallback(async (attempt: Attempt): Promise<Combat2FleeResult> => {
    if (!readyRef.current) return { status: 'local_refusal', classification: 'no_session', reason: 'Combat2 is not ready for input' };
    if (!sessionKey || !characterId || !encounterId || attempt.sessionKey !== sessionKey) {
      return { status: 'local_refusal', classification: 'no_session', reason: 'Combat2 session is not authoritative' };
    }
    if (attempt.inFlight) {
      return { status: 'local_refusal', classification: 'in_flight', reason: 'Combat2 flee is already being submitted' };
    }
    attempt.inFlight = true;
    const generation = generationRef.current;
    try {
      const outcome = await adapter.flee(encounterId, characterId, attempt.requestId);
      if (!readyRef.current || generationRef.current !== generation || sessionKeyRef.current !== attempt.sessionKey) return { status: 'stale' };
      attempt.inFlight = false;
      if (outcome.status === 'fled') onExited(attempt.sessionKey);
      if (outcome.status === 'queued') onQueued?.();
      return outcome;
    } catch (error) {
      if (!readyRef.current || generationRef.current !== generation || sessionKeyRef.current !== attempt.sessionKey) return { status: 'stale' };
      attempt.inFlight = false;
      return {
        status: error instanceof Combat2FleeError && error.code === 'uncertain' ? 'uncertain' : 'error',
        reason: error instanceof Error ? error.message : 'combat_flee failed',
      };
    }
  }, [adapter, characterId, encounterId, onExited, onQueued, sessionKey]);

  const flee = useCallback(() => {
    if (!enabled) return Promise.resolve<Combat2FleeResult>({ status: 'local_refusal', classification: 'disabled', reason: 'Combat2 is disabled' });
    if (!sessionKey) return Promise.resolve<Combat2FleeResult>({ status: 'local_refusal', classification: 'no_session', reason: 'Combat2 session is not authoritative' });
    if (attemptRef.current?.inFlight) return Promise.resolve<Combat2FleeResult>({ status: 'local_refusal', classification: 'in_flight', reason: 'Combat2 flee is already being submitted' });
    const attempt: Attempt = { requestId: generateRequestId(), sessionKey, inFlight: false };
    attemptRef.current = attempt;
    return run(attempt);
  }, [enabled, generateRequestId, run, sessionKey]);

  const retry = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt) return Promise.resolve<Combat2FleeResult>({ status: 'local_refusal', classification: 'no_retry', reason: 'No Combat2 flee can be retried' });
    return run(attempt);
  }, [run]);

  return { flee, retry };
}
