/**
 * encounter-batch.ts — B5: ordered, idempotent consumption of the shared
 * `encounter_tick_batches` stream.
 *
 * The realtime stream is the *truth*; the HTTP response and the party
 * broadcast are only fast-path hints carrying the same content. Realtime can
 * deliver out of order, duplicate a row, or drop one entirely, so every batch
 * passes through this pure sequencer before it reaches the driver:
 *
 *  - duplicates (same `batch_id`, or a tick already applied) are dropped;
 *  - out-of-order arrivals are buffered until their predecessor lands;
 *  - a gap (`tick_number > next expected`) is reported so the caller can fetch
 *    the missing range from the table and feed it back in.
 *
 * No React, no Supabase — the whole ordering contract is unit-testable.
 */
import type { CombatTickResponse } from './interpretCombatTickResult';

export interface EncounterBatchRow {
  batch_id: string;
  encounter_id: string;
  tick_number: number;
  payload: unknown;
}

/** What the sequencer decided about the batches it just absorbed. */
export interface SequencerOutcome {
  /** Batches ready to apply, strictly ascending by `tick_number`. */
  ready: EncounterBatchRow[];
  /** Inclusive tick range that must be fetched before buffered rows can apply. */
  gap: { fromTick: number; toTick: number } | null;
}

/**
 * Translate a stored batch payload back into the tick-response shape the
 * client interpreter already understands. `commit_encounter_tick` stores
 * exactly the fields the HTTP response carries, so this is a re-labelling.
 */
export function batchToTickResponse(row: EncounterBatchRow): CombatTickResponse | null {
  const p = row.payload as Record<string, any> | null;
  if (!p || typeof p !== 'object') return null;
  if (!Array.isArray(p.events) || !Array.isArray(p.creature_states)) return null;
  return {
    events: p.events,
    creature_states: p.creature_states,
    member_states: p.member_states ?? [],
    alive_creature_ids: p.alive_creature_ids,
    cleared_dots: p.cleared_dots,
    consumed_buffs: p.consumed_buffs,
    consumed_ability_stacks: p.consumed_ability_stacks,
    session_ended: p.session_ended,
    ticks_processed: p.ticks_processed ?? 1,
    encounter_tick: row.tick_number,
    encounter_batch_id: row.batch_id,
  } as CombatTickResponse;
}

/** Max buffered out-of-order rows before the oldest are discarded. */
const MAX_BUFFER = 32;
/** Max remembered batch ids for duplicate suppression. */
const MAX_SEEN = 200;

export class EncounterBatchSequencer {
  private lastAppliedTick = 0;
  private seen = new Set<string>();
  private buffer = new Map<number, EncounterBatchRow>();

  /** Adopt a tick number already applied through the fast path (HTTP/broadcast). */
  markApplied(tickNumber: number, batchId?: string | null): void {
    if (batchId) this.remember(batchId);
    if (tickNumber > this.lastAppliedTick) this.lastAppliedTick = tickNumber;
    for (const tick of [...this.buffer.keys()]) {
      if (tick <= this.lastAppliedTick) this.buffer.delete(tick);
    }
  }

  /** Reset for a new encounter (or when combat stops). */
  reset(): void {
    this.lastAppliedTick = 0;
    this.seen = new Set();
    this.buffer.clear();
  }

  get nextExpectedTick(): number {
    return this.lastAppliedTick + 1;
  }

  /**
   * Absorb one or more rows and return whatever is now applicable in order.
   * Safe to call with rows fetched during gap recovery.
   */
  ingest(rows: EncounterBatchRow | EncounterBatchRow[]): SequencerOutcome {
    const incoming = Array.isArray(rows) ? rows : [rows];
    for (const row of incoming) {
      if (!row || typeof row.tick_number !== 'number') continue;
      if (this.seen.has(row.batch_id)) continue;
      if (row.tick_number <= this.lastAppliedTick) {
        this.remember(row.batch_id);
        continue;
      }
      this.buffer.set(row.tick_number, row);
    }

    // First batch ever seen for this encounter: adopt its tick as the origin
    // rather than demanding a fetch back to tick 1.
    if (this.lastAppliedTick === 0 && this.buffer.size > 0) {
      this.lastAppliedTick = Math.min(...this.buffer.keys()) - 1;
    }

    const ready: EncounterBatchRow[] = [];
    for (;;) {
      const next = this.buffer.get(this.lastAppliedTick + 1);
      if (!next) break;
      this.buffer.delete(next.tick_number);
      this.remember(next.batch_id);
      this.lastAppliedTick = next.tick_number;
      ready.push(next);
    }

    let gap: SequencerOutcome['gap'] = null;
    if (this.buffer.size > 0) {
      const lowestBuffered = Math.min(...this.buffer.keys());
      if (lowestBuffered > this.lastAppliedTick + 1) {
        gap = { fromTick: this.lastAppliedTick + 1, toTick: lowestBuffered - 1 };
      }
      if (this.buffer.size > MAX_BUFFER) {
        // Runaway buffer means recovery is not converging; drop the oldest and
        // re-anchor so the fight keeps moving on the fast path.
        const oldest = Math.min(...this.buffer.keys());
        this.buffer.delete(oldest);
      }
    }

    return { ready, gap };
  }

  private remember(batchId: string): void {
    this.seen.add(batchId);
    if (this.seen.size > MAX_SEEN) {
      this.seen = new Set([...this.seen].slice(-Math.floor(MAX_SEEN / 2)));
    }
  }
}
