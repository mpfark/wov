/**
 * combat2/rng.ts — the single seeded randomness API of the replacement resolver.
 *
 * Seed identity is `(encounterId, candidateTick, stream, ...parts)`. A tick that
 * is reclaimed after a lease expiry re-resolves with the SAME candidate tick, so
 * an identical snapshot reproduces an identical result. `Math.random()` is
 * forbidden anywhere in `src/shared/combat2`.
 */

export interface TickSeed {
  encounterId: string;
  candidateTick: number;
}

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

export class TickRandom {
  constructor(private readonly seed: TickSeed) {}

  /** Stable 0..1 sample for one identified decision inside this tick. */
  sample(stream: string, ...parts: Array<string | number>): number {
    const h = hashParts([this.seed.encounterId, this.seed.candidateTick, stream, ...parts]);
    return (h >>> 8) / 0x01000000;
  }

  /** Stable die roll in 1..sides (0 for a nonsensical die). */
  roll(stream: string, sides: number, ...parts: Array<string | number>): number {
    if (!Number.isFinite(sides) || sides < 1) return 0;
    return 1 + Math.floor(this.sample(stream, ...parts) * sides);
  }

  d20(stream: string, ...parts: Array<string | number>): number {
    return this.roll(stream, 20, ...parts);
  }

  /** Stable uniform pick from an ordered list. */
  pick<T>(list: readonly T[], stream: string, ...parts: Array<string | number>): T | undefined {
    if (list.length === 0) return undefined;
    return list[Math.floor(this.sample(stream, ...parts) * list.length) % list.length];
  }

  /** Stable weighted pick; non-positive weights are ignored. */
  weightedPick<T>(
    list: readonly T[],
    weightOf: (item: T) => number,
    stream: string,
    ...parts: Array<string | number>
  ): T | undefined {
    const usable = list.filter((item) => weightOf(item) > 0);
    if (usable.length === 0) return undefined;
    const total = usable.reduce((sum, item) => sum + weightOf(item), 0);
    let cursor = this.sample(stream, ...parts) * total;
    for (const item of usable) {
      cursor -= weightOf(item);
      if (cursor <= 0) return item;
    }
    return usable[usable.length - 1];
  }
}
