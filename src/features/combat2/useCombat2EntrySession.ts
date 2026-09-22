import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Combat2EntryError,
  createCombat2EntryAdapter,
  type Combat2EntryAdapter,
  type Combat2EntryClassification,
  type Combat2EntryClient,
  type Combat2EntryRefusal,
  type Combat2EntryOutcome,
} from './entry';

export type Combat2EntrySessionStatus =
  | 'disabled'
  | 'idle'
  | 'entering'
  | 'entered'
  | 'refused'
  | 'uncertain'
  | 'error';

export interface Combat2EntrySessionState {
  status: Combat2EntrySessionStatus;
  encounterId: string | null;
  fighterId: string | null;
  entrySeq: number | null;
  classification: Combat2EntryClassification | Combat2EntryRefusal | null;
  error: string | null;
  retry(): void;
  engage(targetCreatureId: string): Promise<Combat2EntryOutcome>;
}

export interface UseCombat2EntrySessionOptions {
  enabled: boolean;
  characterId: string | null;
  nodeId: string | null;
  hasLivingCreatures: boolean | null;
  adapter?: Combat2EntryAdapter;
  generateRequestId?: () => string;
}

interface Attempt {
  key: string;
  requestId: string;
  inFlight: boolean;
  completed: boolean;
  promise?: Promise<Combat2EntryOutcome>;
  observerGeneration?: number;
}

interface InternalState extends Omit<Combat2EntrySessionState, 'retry' | 'engage'> { key: string | null }

const defaultAdapter = createCombat2EntryAdapter({
  rpc: (name, args) => supabase.rpc(name as never, args as never),
} satisfies Combat2EntryClient);
const defaultRequestId = () => crypto.randomUUID();

const EMPTY: Omit<Combat2EntrySessionState, 'retry' | 'engage'> = {
  status: 'idle', encounterId: null, fighterId: null, entrySeq: null, classification: null, error: null,
};

export function useCombat2EntrySession({
  enabled,
  characterId,
  nodeId,
  hasLivingCreatures,
  adapter = defaultAdapter,
  generateRequestId = defaultRequestId,
}: UseCombat2EntrySessionOptions): Combat2EntrySessionState {
  const sessionKey = enabled && characterId && nodeId ? `${characterId}:${nodeId}` : null;
  const currentKeyRef = useRef(sessionKey);
  currentKeyRef.current = sessionKey;
  const generationRef = useRef(0);
  const attemptRef = useRef<Attempt | null>(null);
  const engagementRef = useRef<{ key: string; targetCreatureId: string; requestId: string; inFlight: boolean; uncertain: boolean } | null>(null);
  const [state, setState] = useState<InternalState>({ ...EMPTY, key: null });

  const runAttempt = useCallback((attempt: Attempt, generation: number) => {
    if (!characterId) return;
    attempt.inFlight = true;
    attempt.observerGeneration = generation;
    setState({ ...EMPTY, key: attempt.key, status: 'entering' });
    attempt.promise ??= adapter.enter(characterId, attempt.requestId);
    void attempt.promise.then((outcome) => {
      if (generationRef.current !== generation || currentKeyRef.current !== attempt.key) return;
      attempt.inFlight = false;
      attempt.promise = undefined;
      attempt.completed = true;
      if (outcome.status === 'entered') {
        setState({
          key: attempt.key,
          status: 'entered',
          encounterId: outcome.encounterId,
          fighterId: outcome.fighterId,
          entrySeq: outcome.entrySeq,
          classification: outcome.classification,
          error: null,
        });
      } else {
        setState({ ...EMPTY, key: attempt.key, status: 'refused', classification: outcome.classification, error: outcome.reason });
      }
    }).catch((error) => {
      if (generationRef.current !== generation || currentKeyRef.current !== attempt.key) return;
      attempt.inFlight = false;
      attempt.promise = undefined;
      const uncertain = error instanceof Combat2EntryError && error.code === 'uncertain';
      attempt.completed = !uncertain;
      setState({
        ...EMPTY,
        key: attempt.key,
        status: uncertain ? 'uncertain' : 'error',
        error: error instanceof Error ? error.message : 'combat_enter failed',
      });
    });
  }, [adapter, characterId]);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (attemptRef.current?.key !== sessionKey) attemptRef.current = null;
    if (engagementRef.current?.key !== sessionKey) engagementRef.current = null;
    setState({ ...EMPTY, key: sessionKey });
    return () => {
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [sessionKey]);

  useEffect(() => {
    if (!sessionKey || !characterId || hasLivingCreatures !== true || attemptRef.current?.completed
      || attemptRef.current?.observerGeneration === generationRef.current) return;
    const attempt: Attempt = attemptRef.current ?? { key: sessionKey, requestId: generateRequestId(), inFlight: false, completed: false };
    attemptRef.current = attempt;
    runAttempt(attempt, generationRef.current);
  }, [sessionKey, characterId, hasLivingCreatures, generateRequestId, runAttempt]);

  const retry = useCallback(() => {
    if (!sessionKey || !characterId || hasLivingCreatures !== true) return;
    const current = attemptRef.current;
    if (current?.inFlight || state.status === 'entered') return;
    const attempt = current && !current.completed
      ? current
      : { key: sessionKey, requestId: generateRequestId(), inFlight: false, completed: false };
    attemptRef.current = attempt;
    runAttempt(attempt, generationRef.current);
  }, [sessionKey, characterId, hasLivingCreatures, state.status, generateRequestId, runAttempt]);

  const engage = useCallback(async (targetCreatureId: string): Promise<Combat2EntryOutcome> => {
    if (!sessionKey || !characterId || !adapter.engage) return { status: 'refused', classification: 'refused', reason: 'session_unavailable' };
    const previous = engagementRef.current;
    if (previous?.key === sessionKey && previous.targetCreatureId === targetCreatureId && previous.inFlight) {
      return { status: 'refused', classification: 'refused', reason: 'in_flight' };
    }
    const engagement = previous?.key === sessionKey && previous.targetCreatureId === targetCreatureId && previous.uncertain
      ? previous
      : { key: sessionKey, targetCreatureId, requestId: generateRequestId(), inFlight: false, uncertain: false };
    engagement.inFlight = true;
    engagementRef.current = engagement;
    // A deliberate hostile action supersedes a speculative automatic entry.
    // Advancing the generation prevents that older response from restoring a
    // refused/idle state after the engagement has established ownership.
    const generation = ++generationRef.current;
    setState({ ...EMPTY, key: sessionKey, status: 'entering' });
    try {
      const outcome = await adapter.engage(characterId, targetCreatureId, engagement.requestId);
      engagement.inFlight = false;
      engagement.uncertain = false;
      if (generationRef.current !== generation || currentKeyRef.current !== sessionKey) {
        return { status: 'refused', classification: 'refused', reason: 'stale_session' };
      }
      if (outcome.status === 'entered') {
        attemptRef.current = { key: sessionKey, requestId: '', inFlight: false, completed: true };
        setState({ key: sessionKey, status: 'entered', encounterId: outcome.encounterId,
          fighterId: outcome.fighterId, entrySeq: outcome.entrySeq,
          classification: outcome.classification, error: null });
      } else {
        setState({ ...EMPTY, key: sessionKey, status: 'refused', classification: outcome.classification, error: outcome.reason });
      }
      return outcome;
    } catch (error) {
      engagement.inFlight = false;
      engagement.uncertain = error instanceof Combat2EntryError && error.code === 'uncertain';
      if (generationRef.current === generation && currentKeyRef.current === sessionKey) {
        setState({ ...EMPTY, key: sessionKey, status: 'uncertain', error: error instanceof Error ? error.message : 'combat2_engage failed' });
      }
      throw error;
    }
  }, [sessionKey, characterId, adapter, generateRequestId]);

  return useMemo(() => {
    if (!enabled) return { ...EMPTY, status: 'disabled' as const, retry, engage };
    if (!characterId || !nodeId) return { ...EMPTY, status: 'idle' as const, retry, engage };
    if (state.key === sessionKey && state.status !== 'idle') return { ...state, retry, engage };
    if (hasLivingCreatures !== true || state.key !== sessionKey) return { ...EMPTY, status: 'idle' as const, retry, engage };
    return { ...state, retry, engage };
  }, [enabled, characterId, nodeId, hasLivingCreatures, state, sessionKey, retry, engage]);
}
