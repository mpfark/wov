/**
 * encounter-batch.ts — C4: ordered, idempotent consumption of the shared
 * `encounter_tick_batches` stream.
 *
 * Delivery authority: a committed batch is the ONLY thing a client may render.
 * The HTTP response of `combat-tick` and the party broadcast are *acknowledgements*
 * — they tell us a tick number was committed, nothing more. They never carry
 * applicable state, so a lost or reordered realtime message can never leave two
 * clients showing different fights.
 *
 * Every batch therefore passes through this pure sequencer before it reaches the
 * driver:
 *
 *  - duplicates (same `batch_id`, or a tick already applied) are dropped;
 *  - out-of-order arrivals are buffered until their predecessor lands;
 *  - anything missing between the applied cursor and the highest tick we know
 *    was committed is reported as a `missing` range for the recovery machine to
 *    fetch and feed back in.
 *
 * No React, no Supabase — the whole ordering contract is unit-testable.
 */
import { decodeTickBatch, type DecodedBatch } from '@/shared/combat/c3/decode-batch';
import type { CombatTickResponse } from './interpretCombatTickResult';

export interface EncounterBatchRow {
  batch_id: string;
  encounter_id: string;
  tick_number: number;
  payload: unknown;
}

/** What the sequencer decided about the batches (or acks) it just absorbed. */
export interface SequencerOutcome {
  /** Batches ready to apply, strictly ascending by `tick_number`. */
  ready: EncounterBatchRow[];
  /** Inclusive tick range that must be fetched before the cursor can advance. */
  missing: { fromTick: number; toTick: number } | null;
}

/** Baseline absolutes used to turn committed reward deltas into client state. */
export interface BatchBaseline {
  readonly xp: number;
  readonly gold: number;
  readonly level: number;
  readonly maxHp: number;
  readonly renown?: number;
  readonly renownTotalEarned?: number;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter(r => r && typeof r === 'object') as Record<string, unknown>[]) : [];
}

/**
 * Translate a committed batch (envelope v3) into the tick-response shape the
 * client interpreter understands.
 *
 * `baselines` supply the caller's current absolutes so the batch's *reward
 * deltas* (xp, gold, renown) can be presented as absolutes. Level-ups carry
 * server-authoritative absolutes and always win over the delta arithmetic.
 */
export function batchToTickResponse(
  row: EncounterBatchRow,
  baselines?: Readonly<Record<string, BatchBaseline>>,
): CombatTickResponse | null {
  let batch: DecodedBatch;
  try {
    batch = decodeTickBatch(row.payload);
  } catch (err) {
    console.warn('[encounter-batch] refusing undecodable batch', row.batch_id, (err as Error).message);
    return null;
  }

  const rewards = rows(batch.rewards);
  const progression = rows(batch.progression);
  const consumedBuffs = rows(batch.consumedBuffs);

  const creatureNames = new Map<string, string>();
  for (const c of batch.creatures) if (c.creatureName) creatureNames.set(c.creatureId, c.creatureName);

  const memberStates = batch.characters.map((c) => {
    const base = baselines?.[c.characterId];
    let xp = base?.xp ?? 0;
    let gold = base?.gold ?? 0;
    let level = base?.level ?? 1;
    let maxHp = base?.maxHp ?? c.hpAfter;
    let renown = base?.renown;
    let renownTotal = base?.renownTotalEarned;

    for (const r of rewards) {
      if (str(r.characterId) !== c.characterId) continue;
      xp += num(r.xp);
      gold += num(r.gold);
      const rp = num(r.renown);
      if (rp !== 0) {
        renown = (renown ?? 0) + rp;
        renownTotal = (renownTotal ?? 0) + rp;
      }
    }

    let maxCp: number | undefined;
    let maxMp: number | undefined;
    let unspent: number | undefined;
    let respec: number | undefined;
    for (const p of progression) {
      if (str(p.characterId) !== c.characterId) continue;
      level = num(p.levelAfter, level);
      xp = num(p.xpAfter, xp);
      maxHp = num(p.maxHpAfter, maxHp);
      maxCp = num(p.maxCpAfter, maxCp ?? 0);
      maxMp = num(p.maxMpAfter, maxMp ?? 0);
      const un = num(p.unspentStatPointsDelta);
      const re = num(p.respecPointsDelta);
      if (un !== 0) unspent = (unspent ?? 0) + un;
      if (re !== 0) respec = (respec ?? 0) + re;
    }

    return {
      character_id: c.characterId,
      hp: c.hpAfter,
      cp: c.cpAfter,
      xp,
      gold,
      level,
      max_hp: maxHp,
      ...(maxCp !== undefined ? { max_cp: maxCp } : {}),
      ...(maxMp !== undefined ? { max_mp: maxMp } : {}),
      ...(renown !== undefined ? { bhp: renown } : {}),
      ...(renownTotal !== undefined ? { rp_total_earned: renownTotal } : {}),
      // Level-up stat/respec points are deltas; only forwarded when non-zero so
      // the interpreter never overwrites an absolute with a delta.
      ...(unspent !== undefined ? { unspent_stat_points: unspent } : {}),
      ...(respec !== undefined ? { respec_points: respec } : {}),
    };
  });

  const aliveCreatureIds = batch.creatures.filter(c => !c.killed && c.hpAfter > 0).map(c => c.creatureId);

  const buffSync: Record<string, { absorb_remaining: number }> = {};
  for (const c of batch.characters) buffSync[c.characterId] = { absorb_remaining: c.absorbShieldAfter };

  const session = (batch.session ?? {}) as Record<string, unknown>;

  return {
    events: batch.events.map(e => ({
      type: e.type,
      message: e.message,
      ...(e.characterId ? { character_id: e.characterId } : {}),
      ...(e.creatureId ? { creature_id: e.creatureId } : {}),
      ...(e.creatureId && creatureNames.has(e.creatureId)
        ? { creature_name: creatureNames.get(e.creatureId)! }
        : {}),
    })),
    creature_states: batch.creatures.map(c => ({
      id: c.creatureId,
      hp: c.hpAfter,
      alive: !c.killed && c.hpAfter > 0,
    })),
    member_states: memberStates,
    consumed_buffs: consumedBuffs.map(b => ({
      type: 'consumed_buff',
      character_id: str(b.characterId) ?? '',
      buff: str(b.buff) ?? '',
    })),
    alive_creature_ids: aliveCreatureIds,
    session_ended: session.ended === true,
    buff_sync: buffSync,
    ticks_processed: batch.ticksProcessed,
    encounter_tick: batch.tick,
    encounter_batch_id: batch.batchId,
    encounter_id: row.encounter_id,
  } satisfies CombatTickResponse;
}

/** Max buffered out-of-order rows before the oldest are discarded. */
const MAX_BUFFER = 64;
/** Max remembered batch ids for duplicate suppression. */
const MAX_SEEN = 400;
/** Never ask recovery for a wider window than this in one pass. */
const MAX_RECOVERY_WIDTH = 64;

export class EncounterBatchSequencer {
  private lastAppliedTick = 0;
  private highestKnownCommittedTick = 0;
  private anchored = false;
  private seen = new Set<string>();
  private buffer = new Map<number, EncounterBatchRow>();

  /** Reset for a new encounter (or when combat stops). */
  reset(): void {
    this.lastAppliedTick = 0;
    this.highestKnownCommittedTick = 0;
    this.anchored = false;
    this.seen = new Set();
    this.buffer.clear();
  }

  get nextExpectedTick(): number {
    return this.lastAppliedTick + 1;
  }

  get appliedTick(): number {
    return this.lastAppliedTick;
  }

  get highestKnownTick(): number {
    return this.highestKnownCommittedTick;
  }

  hasSeen(batchId: string): boolean {
    return this.seen.has(batchId);
  }

  /**
   * Record an acknowledgement: the server says `tickNumber` is committed. This
   * NEVER marks the tick applied — only the committed batch itself may advance
   * the render cursor — but it does tell the recovery machine what to fetch.
   */
  noteCommitted(tickNumber: number | null | undefined, batchId?: string | null): SequencerOutcome {
    if (typeof tickNumber !== 'number' || !Number.isFinite(tickNumber)) {
      return { ready: [], missing: this.missingRange() };
    }
    if (tickNumber > this.highestKnownCommittedTick) this.highestKnownCommittedTick = tickNumber;
    // The first thing we ever learn about an encounter anchors the cursor, so a
    // client joining mid-fight recovers only from that point instead of tick 1.
    if (!this.anchored) {
      this.anchored = true;
      this.lastAppliedTick = tickNumber - 1;
    }
    if (batchId && this.seen.has(batchId)) {
      // Already applied from the stream; nothing outstanding for this tick.
    }
    return { ready: [], missing: this.missingRange() };
  }

  /**
   * Absorb one or more committed rows and return whatever is now applicable in
   * strict tick order. Safe to call with rows fetched during recovery.
   */
  ingest(rowsIn: EncounterBatchRow | EncounterBatchRow[]): SequencerOutcome {
    const incoming = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
    for (const row of incoming) {
      if (!row || typeof row.tick_number !== 'number') continue;
      if (row.tick_number > this.highestKnownCommittedTick) {
        this.highestKnownCommittedTick = row.tick_number;
      }
      if (this.seen.has(row.batch_id)) continue;
      if (this.anchored && row.tick_number <= this.lastAppliedTick) {
        this.remember(row.batch_id);
        continue;
      }
      this.buffer.set(row.tick_number, row);
    }

    if (!this.anchored && this.buffer.size > 0) {
      this.anchored = true;
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

    if (this.buffer.size > MAX_BUFFER) {
      // Recovery is not converging. Re-anchor onto the oldest buffered tick so
      // the fight keeps rendering rather than stalling forever behind a hole.
      const oldest = Math.min(...this.buffer.keys());
      this.lastAppliedTick = oldest - 1;
    }

    return { ready, missing: this.missingRange() };
  }

  /**
   * The contiguous hole in front of the render cursor, bounded so one recovery
   * pass can never request an unbounded range.
   */
  missingRange(): { fromTick: number; toTick: number } | null {
    if (!this.anchored) return null;
    const from = this.lastAppliedTick + 1;
    const lowestBuffered = this.buffer.size > 0 ? Math.min(...this.buffer.keys()) : null;
    const upper = lowestBuffered !== null
      ? Math.min(lowestBuffered - 1, Math.max(this.highestKnownCommittedTick, lowestBuffered - 1))
      : this.highestKnownCommittedTick;
    if (upper < from) return null;
    return { fromTick: from, toTick: Math.min(upper, from + MAX_RECOVERY_WIDTH - 1) };
  }

  private remember(batchId: string): void {
    this.seen.add(batchId);
    if (this.seen.size > MAX_SEEN) {
      this.seen = new Set([...this.seen].slice(-Math.floor(MAX_SEEN / 2)));
    }
  }
}
