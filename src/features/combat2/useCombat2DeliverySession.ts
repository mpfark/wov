import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import {
  Combat2DeliveryAdapter,
  Combat2DeliveryError,
  type Combat2DeliveryClient,
  type Combat2DeliveryOptions,
  type Combat2RealtimeChannel,
  type Combat2SyncResult,
  type Combat2TickBatch,
} from './delivery';

export type Combat2DeliverySessionStatus =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'live'
  | 'reconnecting'
  | 'refused'
  | 'gap'
  | 'error';

export interface Combat2DeliverySessionState {
  status: Combat2DeliverySessionStatus;
  snapshot: Combat2SyncResult | null;
  batches: readonly Combat2TickBatch[];
  lastAppliedTick: number;
  error: string | null;
}

export interface Combat2DeliveryController {
  readonly lastAppliedTick: number;
  start(): Promise<Combat2SyncResult>;
  stop(): void;
}

export type Combat2DeliveryControllerFactory = (options: Combat2DeliveryOptions) => Combat2DeliveryController;

export interface UseCombat2DeliverySessionOptions {
  enabled: boolean;
  characterId: string | null;
  encounterId: string | null;
  client?: Combat2DeliveryClient;
  createController?: Combat2DeliveryControllerFactory;
  /** Keep the last authoritative snapshot/batches available after detaching. */
  preserveOnDetach?: boolean;
}

const EMPTY_BATCHES: readonly Combat2TickBatch[] = Object.freeze([]);
const DISABLED_STATE: Combat2DeliverySessionState = Object.freeze({
  status: 'disabled', snapshot: null, batches: EMPTY_BATCHES,
  lastAppliedTick: 0, error: null,
});
const IDLE_STATE: Combat2DeliverySessionState = Object.freeze({
  status: 'idle', snapshot: null, batches: EMPTY_BATCHES,
  lastAppliedTick: 0, error: null,
});
const SYNCING_STATE: Combat2DeliverySessionState = Object.freeze({
  status: 'syncing', snapshot: null, batches: EMPTY_BATCHES,
  lastAppliedTick: 0, error: null,
});

const defaultClient: Combat2DeliveryClient = {
  rpc: (name, args) => supabase.rpc(name, args),
  channel: (name) => supabase.channel(name) as unknown as Combat2RealtimeChannel,
  removeChannel: (channel) => supabase.removeChannel(channel as unknown as RealtimeChannel),
};

const defaultFactory: Combat2DeliveryControllerFactory = (options) => new Combat2DeliveryAdapter(options);

interface ActiveState extends Combat2DeliverySessionState { sessionKey: string }

function errorStatus(error: unknown): Extract<Combat2DeliverySessionStatus, 'refused' | 'gap' | 'error'> {
  return error instanceof Combat2DeliveryError && error.code === 'refused'
    ? 'refused'
    : error instanceof Combat2DeliveryError && error.code === 'gap'
      ? 'gap'
      : 'error';
}

/**
 * Owns one recoverable Combat2 delivery session. It never starts without the
 * rollout gate, an owned character id, and an explicit Combat2 encounter id.
 */
export function useCombat2DeliverySession({
  enabled,
  characterId,
  encounterId,
  client = defaultClient,
  createController = defaultFactory,
  preserveOnDetach = false,
}: UseCombat2DeliverySessionOptions): Combat2DeliverySessionState {
  const requestedKey = enabled && characterId && encounterId ? `${characterId}:${encounterId}` : null;
  const currentKeyRef = useRef<string | null>(requestedKey);
  currentKeyRef.current = requestedKey;
  const [active, setActive] = useState<ActiveState | null>(null);
  const controllerRef = useRef<Combat2DeliveryController | null>(null);

  useEffect(() => {
    if (!requestedKey || !characterId || !encounterId) {
      controllerRef.current?.stop();
      controllerRef.current = null;
      return;
    }

    const key = requestedKey;
    setActive({ ...SYNCING_STATE, sessionKey: key });

    const applyError = (error: unknown) => {
      if (currentKeyRef.current !== key) return;
      setActive((previous) => previous?.sessionKey === key ? {
        ...previous,
        status: errorStatus(error),
        error: error instanceof Error ? error.message : 'Combat2 delivery failed',
      } : previous);
    };

    const controller = createController({
      client,
      characterId,
      encounterId,
      onStatus(status) {
        if (currentKeyRef.current !== key) return;
        setActive((previous) => previous?.sessionKey === key
          ? { ...previous, status, error: null }
          : previous);
      },
      onError: applyError,
      onSync(result) {
        if (currentKeyRef.current !== key) return;
        setActive((previous) => {
          if (previous?.sessionKey !== key) return previous;
          const byTick = new Map(previous.batches.map((batch) => [batch.tick, batch]));
          for (const batch of result.batches) byTick.set(batch.tick, batch);
          return {
            sessionKey: key,
            status: 'live',
            snapshot: result,
            batches: [...byTick.values()].sort((a, b) => a.tick - b.tick),
            lastAppliedTick: result.returned_through_tick,
            error: null,
          };
        });
      },
    });
    controllerRef.current = controller;
    void controller.start().catch(applyError);

    return () => {
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [requestedKey, characterId, encounterId, client, createController]);

  return useMemo(() => {
    if (!enabled) return DISABLED_STATE;
    if (!characterId || !encounterId) {
      return preserveOnDetach && active
        ? { ...active, status: 'idle', error: null }
        : IDLE_STATE;
    }
    return active?.sessionKey === requestedKey ? active : SYNCING_STATE;
  }, [enabled, characterId, encounterId, requestedKey, active, preserveOnDetach]);
}
