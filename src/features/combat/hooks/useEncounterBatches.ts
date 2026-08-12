/**
 * useEncounterBatches — B5: subscribe to the shared tick-result stream.
 *
 * Every participant of an encounter receives the same authoritative
 * `encounter_tick_batches` rows over realtime and applies them in
 * `tick_number` order, exactly once. The HTTP response and the party broadcast
 * stay live as fast-path hints — `markApplied` tells the sequencer about them,
 * so a batch delivered twice is applied once.
 *
 * On a detected gap the missing tick range is fetched straight from the table
 * and fed back through the sequencer, which replaces the old "wait and hope"
 * recovery timer.
 */
import { useEffect, useRef } from 'react';

import { supabase } from '@/integrations/supabase/client';
import {
  EncounterBatchSequencer,
  batchToTickResponse,
  type EncounterBatchRow,
} from '../utils/encounter-batch';
import type { CombatTickResponse } from '../utils/interpretCombatTickResult';

interface Params {
  /** Encounter to follow, or null when not in a shared encounter. */
  encounterId: string | null;
  /** Applied for every batch, already ordered and de-duplicated. */
  onBatch: (result: CombatTickResponse, meta: { tickNumber: number; source: 'realtime' | 'recovery' }) => void;
}

export function useEncounterBatches({ encounterId, onBatch }: Params) {
  const sequencerRef = useRef(new EncounterBatchSequencer());
  const onBatchRef = useRef(onBatch);
  onBatchRef.current = onBatch;
  const recoveringRef = useRef(false);

  useEffect(() => {
    if (!encounterId) return;
    const sequencer = sequencerRef.current;
    sequencer.reset();
    let cancelled = false;

    const emit = (row: EncounterBatchRow, source: 'realtime' | 'recovery') => {
      const result = batchToTickResponse(row);
      if (!result) return;
      onBatchRef.current(result, { tickNumber: row.tick_number, source });
    };

    const recoverGap = async (fromTick: number, toTick: number) => {
      if (recoveringRef.current) return;
      recoveringRef.current = true;
      try {
        const { data, error } = await supabase
          .from('encounter_tick_batches')
          .select('batch_id, encounter_id, tick_number, payload')
          .eq('encounter_id', encounterId)
          .gte('tick_number', fromTick)
          .lte('tick_number', toTick)
          .order('tick_number', { ascending: true });
        if (error) {
          console.warn('[encounter-batch] gap recovery failed', error.message);
          return;
        }
        if (cancelled || !data?.length) return;
        const outcome = sequencer.ingest(data as EncounterBatchRow[]);
        for (const row of outcome.ready) emit(row, 'recovery');
      } finally {
        recoveringRef.current = false;
      }
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
          const row = payload.new as EncounterBatchRow;
          const outcome = sequencer.ingest(row);
          for (const ready of outcome.ready) emit(ready, 'realtime');
          if (outcome.gap) void recoverGap(outcome.gap.fromTick, outcome.gap.toTick);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [encounterId]);

  /** Register a batch applied through the fast path so realtime skips it. */
  const markApplied = (tickNumber: number | null | undefined, batchId: string | null | undefined) => {
    if (typeof tickNumber !== 'number') return;
    sequencerRef.current.markApplied(tickNumber, batchId ?? null);
  };

  return { markApplied };
}
