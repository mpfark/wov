/**
 * useEncounterBatches — C4: the single delivery path for combat results.
 *
 * Every participant of an encounter receives the same committed
 * `encounter_tick_batches` rows over realtime and applies them in strict
 * `tick_number` order, exactly once. The HTTP response of `combat-tick` and the
 * party broadcast are acknowledgements only: they call `noteCommitted`, which
 * tells this hook what should exist, never what to render.
 *
 * Recovery is a convergent state machine rather than a one-shot fetch:
 *
 *  - a hole in front of the render cursor schedules a fetch of exactly that
 *    range (bounded by the sequencer);
 *  - concurrent requests are collapsed — a fetch in flight defers the next
 *    evaluation instead of stacking;
 *  - failures back off (250ms → 4s) and retry while the hole persists;
 *  - regaining focus/visibility, resubscribing, or reconnecting re-evaluates,
 *    so a backgrounded tab converges as soon as it comes back.
 */
import { useCallback, useEffect, useRef } from 'react';

import { supabase } from '@/integrations/supabase/client';
import {
  EncounterBatchSequencer,
  batchToTickResponse,
  type BatchBaseline,
  type EncounterBatchRow,
} from '../utils/encounter-batch';
import type { CombatTickResponse } from '../utils/interpretCombatTickResult';

export type BatchSource = 'realtime' | 'recovery' | 'resubscribe';

interface Params {
  /** Encounter to follow, or null when not in a shared encounter. */
  encounterId: string | null;
  /** Applied for every committed batch, already ordered and de-duplicated. */
  onBatch: (result: CombatTickResponse, meta: { tickNumber: number; source: BatchSource }) => void;
  /**
   * Current absolutes for characters whose reward deltas must be presented as
   * absolutes (normally just the local character). Read at delivery time.
   */
  baselines?: () => Readonly<Record<string, BatchBaseline>>;
}

const BACKOFF_START_MS = 250;
const BACKOFF_MAX_MS = 4000;
/** How long to wait for realtime before recovering an acknowledged tick. */
const ACK_GRACE_MS = 400;

export function useEncounterBatches({ encounterId, onBatch, baselines }: Params) {
  const sequencerRef = useRef(new EncounterBatchSequencer());
  const onBatchRef = useRef(onBatch);
  onBatchRef.current = onBatch;
  const baselinesRef = useRef(baselines);
  baselinesRef.current = baselines;

  const encounterIdRef = useRef<string | null>(encounterId);
  const fetchingRef = useRef(false);
  const backoffRef = useRef(BACKOFF_START_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  /** Re-evaluate the hole; assigned by the effect below. */
  const evaluateRef = useRef<(delayMs?: number) => void>(() => {});

  const emit = useCallback((row: EncounterBatchRow, source: BatchSource) => {
    const result = batchToTickResponse(row, baselinesRef.current?.());
    if (!result) return;
    onBatchRef.current(result, { tickNumber: row.tick_number, source });
  }, []);

  useEffect(() => {
    encounterIdRef.current = encounterId;
    const sequencer = sequencerRef.current;
    sequencer.reset();
    cancelledRef.current = false;
    backoffRef.current = BACKOFF_START_MS;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!encounterId) return;

    const ingest = (rows: EncounterBatchRow | EncounterBatchRow[], source: BatchSource) => {
      const outcome = sequencer.ingest(rows);
      for (const ready of outcome.ready) emit(ready, source);
      if (outcome.missing) schedule(backoffRef.current);
      else backoffRef.current = BACKOFF_START_MS;
    };

    const runRecovery = async () => {
      if (cancelledRef.current || fetchingRef.current) return;
      const missing = sequencer.missingRange();
      if (!missing) { backoffRef.current = BACKOFF_START_MS; return; }
      fetchingRef.current = true;
      try {
        const { data, error } = await supabase
          .from('encounter_tick_batches')
          .select('batch_id, encounter_id, tick_number, payload')
          .eq('encounter_id', encounterId)
          .gte('tick_number', missing.fromTick)
          .lte('tick_number', missing.toTick)
          .order('tick_number', { ascending: true });
        if (cancelledRef.current) return;
        if (error) {
          console.warn('[encounter-batch] recovery fetch failed', error.message);
          backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
          schedule(backoffRef.current);
          return;
        }
        if (!data?.length) {
          // The range is not committed (yet) or has been pruned. Back off; if it
          // never lands the sequencer re-anchors once the buffer grows.
          backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
          schedule(backoffRef.current);
          return;
        }
        ingest(data as EncounterBatchRow[], 'recovery');
      } finally {
        fetchingRef.current = false;
      }
    };

    function schedule(delayMs: number) {
      if (cancelledRef.current || timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void runRecovery();
      }, Math.max(0, delayMs));
    }

    evaluateRef.current = (delayMs = ACK_GRACE_MS) => {
      if (!sequencer.missingRange()) return;
      schedule(delayMs);
    };

    const channel = supabase
      .channel(`encounter-batches-${encounterId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'encounter_tick_batches',
          filter: `encounter_id=eq.${encounterId}`,
        },
        (payload) => {
          ingest(payload.new as EncounterBatchRow, 'realtime');
        },
      )
      .subscribe((status) => {
        // A fresh subscription may have missed inserts while it was setting up
        // (first mount, reconnect after sleep). Converge immediately.
        if (status === 'SUBSCRIBED') evaluateRef.current(0);
      });

    const onWake = () => {
      if (document.visibilityState === 'visible') evaluateRef.current(0);
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);

    return () => {
      cancelledRef.current = true;
      evaluateRef.current = () => {};
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      supabase.removeChannel(channel);
    };
  }, [encounterId, emit]);

  /**
   * Acknowledge a tick the server reported committed (own HTTP response or a
   * party broadcast). Never renders anything — it only bounds recovery.
   */
  const noteCommitted = useCallback((tickNumber: number | null | undefined, batchId?: string | null) => {
    const outcome = sequencerRef.current.noteCommitted(tickNumber, batchId ?? null);
    if (outcome.missing) evaluateRef.current(ACK_GRACE_MS);
  }, []);

  return { noteCommitted };
}
