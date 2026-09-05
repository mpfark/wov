import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Combat2IntentError,
  createCombat2IntentAdapter,
  type Combat2IntentAction,
  type Combat2IntentAdapter,
  type Combat2IntentClient,
  type Combat2IntentOutcome,
} from './intent';

export type Combat2IntentResult =
  | Combat2IntentOutcome
  | { status: 'local_refusal'; classification: 'disabled' | 'no_session' | 'in_flight' | 'no_retry'; reason: string }
  | { status: 'stale' }
  | { status: 'uncertain' | 'error'; reason: string };

interface Attempt {
  action: Combat2IntentAction;
  requestId: string;
  sessionKey: string;
  inFlight: boolean;
  uncertain: boolean;
}

export interface Combat2PendingIntent {
  requestId: string;
  message: string;
  acceptedAtTick: number;
  action: Combat2IntentAction;
}

export interface Combat2IntentFeedback { message: string }

export interface UseCombat2IntentSessionOptions {
  canSubmit?: boolean;
  enabled: boolean;
  characterId: string | null;
  nodeId: string | null;
  encounterId: string | null;
  adapter?: Combat2IntentAdapter;
  generateRequestId?: () => string;
  authoritativeTick?: number | null;
  deliveryStatus?: string;
}

export interface Combat2IntentSession {
  submit(action: Combat2IntentAction, feedback?: Combat2IntentFeedback): Promise<Combat2IntentResult>;
  retry(): Promise<Combat2IntentResult>;
  pending: Combat2PendingIntent | null;
}

const defaultAdapter = createCombat2IntentAdapter({
  rpc: (name, args) => supabase.rpc(name, args as never),
} satisfies Combat2IntentClient);

export function useCombat2IntentSession({
  canSubmit = true,
  enabled,
  characterId,
  nodeId,
  encounterId,
  adapter = defaultAdapter,
  generateRequestId = () => crypto.randomUUID(),
  authoritativeTick = null,
  deliveryStatus = 'live',
}: UseCombat2IntentSessionOptions): Combat2IntentSession {
  const sessionKey = enabled && characterId && nodeId && encounterId
    ? `${characterId}:${nodeId}:${encounterId}`
    : null;
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const readyRef = useRef(canSubmit);
  readyRef.current = canSubmit;
  const generationRef = useRef(0);
  const attemptRef = useRef<Attempt | null>(null);
  const feedbackRef = useRef(new Map<string, Combat2IntentFeedback>());
  const tickRef = useRef(authoritativeTick);
  tickRef.current = authoritativeTick;
  const [pending, setPending] = useState<Combat2PendingIntent | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    attemptRef.current = null;
    feedbackRef.current.clear();
    setPending(null);
    return () => {
      generationRef.current += 1;
      attemptRef.current = null;
    };
  }, [sessionKey, canSubmit]);

  useEffect(() => {
    if (deliveryStatus !== 'live') setPending(null);
  }, [deliveryStatus]);

  useEffect(() => {
    if (pending && authoritativeTick !== null && authoritativeTick > pending.acceptedAtTick) setPending(null);
  }, [authoritativeTick, pending]);

  const run = useCallback(async (attempt: Attempt): Promise<Combat2IntentResult> => {
    if (!readyRef.current) return { status: 'local_refusal', classification: 'no_session', reason: 'Combat2 is not ready for input' };
    if (!sessionKey || !characterId || !encounterId || attempt.sessionKey !== sessionKey) {
      return { status: 'local_refusal', classification: 'no_session', reason: 'Combat2 session is not authoritative' };
    }
    if (attempt.inFlight) {
      return { status: 'local_refusal', classification: 'in_flight', reason: 'Combat2 intent is already being submitted' };
    }
    attempt.inFlight = true;
    attempt.uncertain = false;
    const generation = generationRef.current;
    try {
      const outcome = await adapter.submit(encounterId, characterId, attempt.action, attempt.requestId);
      if (!readyRef.current || generationRef.current !== generation || sessionKeyRef.current !== attempt.sessionKey
        || attemptRef.current !== attempt) {
        return { status: 'stale' };
      }
      attempt.inFlight = false;
      if (outcome.status === 'accepted') {
        const feedback = feedbackRef.current.get(attempt.requestId);
        if (feedback) setPending(current => current?.requestId === attempt.requestId ? current : {
          requestId: attempt.requestId,
          message: feedback.message,
          acceptedAtTick: tickRef.current ?? -1,
          action: attempt.action,
        });
      }
      return outcome;
    } catch (error) {
      if (!readyRef.current || generationRef.current !== generation || sessionKeyRef.current !== attempt.sessionKey
        || attemptRef.current !== attempt) {
        return { status: 'stale' };
      }
      attempt.inFlight = false;
      attempt.uncertain = error instanceof Combat2IntentError && error.code === 'uncertain';
      return {
        status: attempt.uncertain ? 'uncertain' : 'error',
        reason: error instanceof Error ? error.message : 'combat_intent failed',
      };
    }
  }, [adapter, characterId, encounterId, sessionKey]);

  const submit = useCallback((action: Combat2IntentAction, feedback?: Combat2IntentFeedback) => {
    if (!enabled) {
      return Promise.resolve<Combat2IntentResult>({ status: 'local_refusal', classification: 'disabled', reason: 'Combat2 is disabled' });
    }
    if (!sessionKey) {
      return Promise.resolve<Combat2IntentResult>({ status: 'local_refusal', classification: 'no_session', reason: 'Combat2 session is not authoritative' });
    }
    const current = attemptRef.current;
    if (current?.inFlight && JSON.stringify(current.action) === JSON.stringify(action)) {
      return Promise.resolve<Combat2IntentResult>({ status: 'local_refusal', classification: 'in_flight', reason: 'Combat2 intent is already being submitted' });
    }
    const attempt: Attempt = { action, requestId: generateRequestId(), sessionKey, inFlight: false, uncertain: false };
    attemptRef.current = attempt;
    if (feedback) feedbackRef.current.set(attempt.requestId, feedback);
    return run(attempt);
  }, [enabled, generateRequestId, run, sessionKey]);

  const retry = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt) {
      return Promise.resolve<Combat2IntentResult>({ status: 'local_refusal', classification: 'no_retry', reason: 'No Combat2 intent can be retried' });
    }
    return run(attempt);
  }, [run]);

  return { submit, retry, pending };
}
