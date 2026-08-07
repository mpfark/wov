/**
 * tick-rng.ts — deterministic, retry-stable randomness for encounter ticks.
 *
 * Every nondeterministic choice inside a committed tick (creature target
 * selection, tank-pool pick, status chance, procs, attack/damage rolls, loot
 * rolls) must be seeded from stable inputs: the encounter id, the tick number
 * and a named stream (plus an entity id where a per-entity stream is needed).
 *
 * Why: an encounter tick claim carries an expiring lease. If a resolver dies
 * mid-tick the identical tick number is re-resolved by another resolver. With
 * `Math.random()` the retry would produce a different fight; with these
 * helpers it reproduces the same resolution, so the retry is safe.
 *
 * Mirrored byte-for-byte to `supabase/functions/_shared/combat/tick-rng.ts`.
 */

export interface TickRngContext {
  encounterId: string;
  tickNumber: number;
}

/** FNV-1a + xorshift scramble — same construction as `statusSample`. */
function hashParts(parts: ReadonlyArray<string | number>): number {
  const seed = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h << 13; h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5; h >>>= 0;
  return h >>> 0;
}

/** Stable 0..1 sample for one identified decision inside a tick. */
export function tickSample(
  ctx: TickRngContext,
  stream: string,
  ...parts: Array<string | number>
): number {
  const h = hashParts([ctx.encounterId, ctx.tickNumber, stream, ...parts]);
  return (h >>> 8) / 0x01000000;
}

/** Stable die roll in 1..sides. */
export function tickRoll(
  ctx: TickRngContext,
  stream: string,
  sides: number,
  ...parts: Array<string | number>
): number {
  if (!Number.isFinite(sides) || sides < 1) return 0;
  return 1 + Math.floor(tickSample(ctx, stream, ...parts) * sides);
}

/** Stable uniform pick from an ordered list. */
export function tickPick<T>(
  ctx: TickRngContext,
  stream: string,
  items: readonly T[],
  ...parts: Array<string | number>
): T | null {
  if (items.length === 0) return null;
  const roll = tickSample(ctx, stream, ...parts);
  const idx = Math.min(items.length - 1, Math.max(0, Math.floor(roll * items.length)));
  return items[idx];
}

export interface TickRngStream {
  /** Next 0..1 sample in this stream. */
  next(): number;
  /** Next roll in 1..sides. */
  roll(sides: number): number;
  /** Next uniform pick from an ordered list. */
  pick<T>(items: readonly T[]): T | null;
  /** Samples drawn so far — useful for logs and assertions. */
  readonly drawn: number;
}

/**
 * Sequential stream for a resolution pass that needs many samples in a fixed
 * order (e.g. one creature's attack, then its proc roll). Order of calls is
 * part of the seed, so the pass must be deterministic in its iteration order.
 */
export function createTickRng(
  ctx: TickRngContext,
  stream: string,
  ...parts: Array<string | number>
): TickRngStream {
  let counter = 0;
  return {
    next() {
      return tickSample(ctx, stream, ...parts, counter++);
    },
    roll(sides: number) {
      if (!Number.isFinite(sides) || sides < 1) return 0;
      return 1 + Math.floor(this.next() * sides);
    },
    pick<T>(items: readonly T[]): T | null {
      if (items.length === 0) return null;
      const roll = this.next();
      const idx = Math.min(items.length - 1, Math.max(0, Math.floor(roll * items.length)));
      return items[idx];
    },
    get drawn() {
      return counter;
    },
  };
}

/**
 * Ordered tank pool selection for a shared encounter tick.
 *
 * Multiple parties can be engaged with one creature, so there can be several
 * designated tanks. The pool is caller-ordered (stable: `joined_at`,
 * `character_id`) and the pick is seeded, so every resolver of tick N — first
 * attempt or lease retry — chooses the same tank.
 */
export function selectFromTankPool<T extends { id: string }>(
  ctx: TickRngContext,
  creatureId: string,
  tankPool: readonly T[],
): T | null {
  return tickPick(ctx, 'tank_pool', tankPool, creatureId);
}
