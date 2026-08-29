/**
 * combat2/rng.ts — the single seeded randomness API of the replacement resolver.
 *
 * Seed identity is `(encounterId, candidateTick, stream, ...parts)`. A tick that
 * is reclaimed after a lease expiry re-resolves with the SAME candidate tick, so
 * an identical snapshot reproduces an identical result. `Math.random()` is
 * forbidden anywhere in `src/shared/combat2`.
 *
 * The hash itself is NOT reimplemented here: it delegates to the retained
 * `tick-rng` primitives (`tickSample` / `tickRoll` / `tickPick`), which are the
 * canonical owner of seeded tick randomness and are already mirrored to the edge
 * runtime. Only `weightedPick` — which has no retained equivalent — lives here.
 */

import { tickPick, tickRoll, tickSample, type TickRngContext } from '../combat/tick-rng';

export interface TickSeed {
  encounterId: string;
  candidateTick: number;
}

export class TickRandom {
  private readonly ctx: TickRngContext;

  constructor(seed: TickSeed) {
    this.ctx = { encounterId: seed.encounterId, tickNumber: seed.candidateTick };
  }

  /** Stable 0..1 sample for one identified decision inside this tick. */
  sample(stream: string, ...parts: Array<string | number>): number {
    return tickSample(this.ctx, stream, ...parts);
  }

  /** Stable die roll in 1..sides (0 for a nonsensical die). */
  roll(stream: string, sides: number, ...parts: Array<string | number>): number {
    return tickRoll(this.ctx, stream, sides, ...parts);
  }

  d20(stream: string, ...parts: Array<string | number>): number {
    return this.roll(stream, 20, ...parts);
  }

  /** Stable uniform pick from an ordered list. */
  pick<T>(list: readonly T[], stream: string, ...parts: Array<string | number>): T | undefined {
    return tickPick(this.ctx, stream, list, ...parts) ?? undefined;
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
