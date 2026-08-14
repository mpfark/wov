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
import { parseResyncSnapshot, type ResyncSnapshot } from '../utils/resync';

export type BatchSource = 'realtime' | 'recovery' | 'resubscribe';

interface Params {
  /** Encounter to follow, or null when not in a shared encounter. */
  encounterId: string | null;
  /** Local character — identity for the authoritative resync snapshot. */
  characterId: string | null;
  /** Applied for every committed batch, already ordered and de-duplicated. */
  onBatch: (result: CombatTickResponse, meta: { tickNumber: number; source: BatchSource }) => void;
  /**
   * Current absolutes for characters whose reward deltas must be presented as
   * absolutes (normally just the local character). Read at delivery time.
   */
  baselines?: () => Readonly<Record<string, BatchBaseline>>;
  /**
   * Called with an authoritative snapshot when a required batch range cannot be
   * recovered (pruned, or access expired). The caller MUST replace its local
   * combat state from it — the sequencer cursor is only re-anchored after this
   * returns, so the client never advances past an unapplied committed tick.
   */
  onResync?: (snapshot: ResyncSnapshot, range: { fromTick: number; toTick: number }) => void;
}

const BACKOFF_START_MS = 250;
const BACKOFF_MAX_MS = 4000;
/** How long to wait for realtime before recovering an acknowledged tick. */
const ACK_GRACE_MS = 400;
/**
 * Empty recovery responses tolerated before a range is declared unrecoverable.
 * With the 250ms->4s backoff this is ~20s of retrying, far longer than a commit
 * takes to land, and far shorter than the 180s retention window.
 */
const MAX_EMPTY_RECOVERIES = 6;

export function useEncounterBatches({ encounterId, characterId, onBatch, baselines, onResync }: Params) {
  const sequencerRef = useRef(new EncounterBatchSequencer());
  const onBatchRef = useRef(onBatch);
  onBatchRef.current = onBatch;
  const baselinesRef = useRef(baselines);
  baselinesRef.current = baselines;
  const onResyncRef = useRef(onResync);
  onResyncRef.current = onResync;
  const characterIdRef = useRef<string | null>(characterId);
  characterIdRef.current = characterId;
  const emptyRecoveriesRef = useRef(0);
  const resyncingRef = useRef(false);

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
    emptyRecoveriesRef.current = 0;
    resyncingRef.current = false;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!encounterId) return;

    const ingest = (rows: EncounterBatchRow | EncounterBatchRow[], source: BatchSource) => {
      const outcome = sequencer.ingest(rows);
      for (const ready of outcome.ready) emit(ready, source);
      if (outcome.ready.length > 0) emptyRecoveriesRef.current = 0;
      if (outcome.unrecoverable) { void resynchronise(outcome.unrecoverable); return; }
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
        const fetched = (data ?? []) as EncounterBatchRow[];
        if (!fetched.length) {
          // Either not committed yet, or gone (pruned / access expired). Retry a
          // bounded number of times, then resynchronise authoritatively rather
          // than skipping an unapplied committed tick.
          emptyRecoveriesRef.current += 1;
          if (emptyRecoveriesRef.current >= MAX_EMPTY_RECOVERIES) {
            const range = sequencer.markUnrecoverable();
            if (range) { void resynchronise(range); return; }
          }
          backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
          schedule(backoffRef.current);
          return;
        }
        // A partial answer whose lowest row is past the hole proves the head of
        // the range was pruned: it can never arrive.
        const lowest = Math.min(...fetched.map(r => r.tick_number));
        if (lowest > missing.fromTick) {
          const range = sequencer.markUnrecoverable();
          if (range) {
            sequencerRef.current.ingest(fetched);
            void resynchronise(range);
            return;
          }
        }
        ingest(fetched, 'recovery');
      } finally {
        fetchingRef.current = false;
      }
    };

    /**
     * Authoritative resynchronisation. Replaces local combat state from the
     * snapshot RPC and only then re-anchors the cursor. If the snapshot cannot
     * be read we keep retrying instead of guessing.
     */
    async function resynchronise(range: { fromTick: number; toTick: number }) {
      if (cancelledRef.current || resyncingRef.current) return;
      const charId = characterIdRef.current;
      if (!encounterId || !charId) return;
      resyncingRef.current = true;
      try {
        const { data, error } = await supabase.rpc('encounter_resync_snapshot', {
          _encounter_id: encounterId,
          _character_id: charId,
        });
        if (cancelledRef.current) return;
        if (error) {
          console.warn('[encounter-batch] resync snapshot failed', error.message);
          backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
          schedule(backoffRef.current);
          return;
        }
        const snapshot = parseResyncSnapshot(data);
        if (!snapshot) {
          backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_MAX_MS);
          schedule(backoffRef.current);
          return;
        }
        // 1. authoritative state replacement, 2. cursor re-anchor. Never the
        // other way round.
        onResyncRef.current?.(snapshot, range);
        sequencer.reanchorTo(snapshot.tick);
        emptyRecoveriesRef.current = 0;
        backoffRef.current = BACKOFF_START_MS;
        // Anything committed after the snapshot is still delivered normally.
        if (sequencer.missingRange()) schedule(BACKOFF_START_MS);
      } finally {
        resyncingRef.current = false;
      }
    }

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
