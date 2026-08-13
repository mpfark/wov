/**
 * pure/rng.ts — the complete RNG surface of the pure resolver.
 *
 * Every authoritative decision the audits found on `Math.random()` is routed
 * through a named stream here. A stream key is
 *
 *   (encounterId, tickNumber, streamName, ...stableParts, drawIndex)
 *
 * so the same snapshot resolved twice — first attempt or lease retry, live or
 * catch-up — draws the same numbers, and a *different* authoritative tick
 * number produces a completely different stream.
 *
 * `crypto.randomUUID()` is deliberately absent: identifiers are minted by the
 * committer (C2), never inside the simulation, so they cannot influence an
 * outcome or an ordering.
 */

import { createTickRng, tickSample, type TickRngContext } from '../tick-rng.ts';

/** Every stream the resolver may open. Adding a roll means adding a name here. */
export const RNG_STREAMS = [
  'attack_roll',
  'attack_damage',
  'ability_roll',
  'ability_damage',
  'anti_crit',
  'dodge',
  'block',
  'on_hit_effect',
  'status_chance',
  'proc_select',
  'proc_chance',
  'creature_attack_roll',
  'creature_attack_damage',
  'creature_target',
  'tank_pool',
  'boss_cast_start',
  'loot_entry',
  'gold_chance',
  'gold_amount',
  'gem_chance',
  'gem_pick',
  'durability_slot',
] as const;

export type RngStream = (typeof RNG_STREAMS)[number];

export interface TickRandom {
  /** One 0..1 sample from a named stream keyed by stable parts. */
  sample(stream: RngStream, ...parts: Array<string | number>): number;
  /** Die roll in 1..sides from a named stream. */
  roll(stream: RngStream, sides: number, ...parts: Array<string | number>): number;
  /** Uniform pick from an already-ordered list. */
  pick<T>(stream: RngStream, items: readonly T[], ...parts: Array<string | number>): T | null;
  /** Weighted pick from an already-ordered list. */
  weighted<T>(
    stream: RngStream,
    items: readonly T[],
    weightOf: (item: T) => number,
    ...parts: Array<string | number>
  ): T | null;
  /** Total samples drawn — carried on ProposedTick as a fingerprint. */
  readonly draws: number;
}

/**
 * Build the tick's RNG. Samples are addressed, not sequential: a stream keyed
 * by (participant, creature, tickIndex) yields the same value regardless of
 * how many other rolls happened first, so adding a roll elsewhere in the tick
 * cannot shift an unrelated outcome.
 */
export function createTickRandom(ctx: TickRngContext): TickRandom {
  let draws = 0;
  const api: TickRandom = {
    sample(stream, ...parts) {
      draws++;
      return tickSample(ctx, stream, ...parts);
    },
    roll(stream, sides, ...parts) {
      if (!Number.isFinite(sides) || sides < 1) return 0;
      return 1 + Math.floor(api.sample(stream, ...parts) * sides);
    },
    pick(stream, items, ...parts) {
      if (items.length === 0) return null;
      const s = api.sample(stream, ...parts);
      const idx = Math.min(items.length - 1, Math.max(0, Math.floor(s * items.length)));
      return items[idx];
    },
    weighted(stream, items, weightOf, ...parts) {
      if (items.length === 0) return null;
      let total = 0;
      for (const item of items) {
        const w = weightOf(item);
        total += Number.isFinite(w) && w > 0 ? w : 0;
      }
      if (total <= 0) return null;
      let cursor = api.sample(stream, ...parts) * total;
      for (const item of items) {
        const w = weightOf(item);
        cursor -= Number.isFinite(w) && w > 0 ? w : 0;
        if (cursor < 0) return item;
      }
      return items[items.length - 1];
    },
    get draws() {
      return draws;
    },
  };
  return api;
}

/** Sequential sub-stream, for a pass that needs many draws in fixed order. */
export function createSequentialStream(
  ctx: TickRngContext,
  stream: RngStream,
  ...parts: Array<string | number>
) {
  return createTickRng(ctx, stream, ...parts);
}
