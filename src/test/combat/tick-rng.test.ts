/**
 * tick-rng.test.ts — retry stability of every seeded tick decision.
 *
 * A tick claim carries an expiring lease, so the same tick number can be
 * resolved twice by different resolvers. These tests pin the property that
 * makes that safe: identical inputs always produce identical outcomes.
 */

import { describe, it, expect } from 'vitest';
import {
  tickSample,
  tickRoll,
  tickPick,
  createTickRng,
  selectFromTankPool,
} from '@/shared/combat/tick-rng';
import { selectPrimaryTarget } from '@/shared/combat/targeting';

const ENC = '5f2c1a90-1111-4b6a-9c3d-000000000001';
const ctx = { encounterId: ENC, tickNumber: 42 };

describe('tick-rng determinism', () => {
  it('same context, stream and parts yield the same sample', () => {
    expect(tickSample(ctx, 'attack', 'creature-1')).toBe(tickSample(ctx, 'attack', 'creature-1'));
  });

  it('samples stay in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const s = tickSample({ encounterId: ENC, tickNumber: i }, 'attack', i);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('different tick numbers diverge', () => {
    const a = tickSample({ encounterId: ENC, tickNumber: 1 }, 'attack', 'c1');
    const b = tickSample({ encounterId: ENC, tickNumber: 2 }, 'attack', 'c1');
    expect(a).not.toBe(b);
  });

  it('different streams diverge', () => {
    expect(tickSample(ctx, 'attack', 'c1')).not.toBe(tickSample(ctx, 'proc', 'c1'));
  });

  it('different encounters diverge', () => {
    const other = { encounterId: '5f2c1a90-1111-4b6a-9c3d-000000000002', tickNumber: 42 };
    expect(tickSample(ctx, 'attack', 'c1')).not.toBe(tickSample(other, 'attack', 'c1'));
  });

  it('rolls stay within 1..sides and repeat', () => {
    for (let i = 0; i < 200; i++) {
      const r = tickRoll({ encounterId: ENC, tickNumber: i }, 'damage', 20, 'c1');
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(20);
    }
    expect(tickRoll(ctx, 'damage', 20, 'c1')).toBe(tickRoll(ctx, 'damage', 20, 'c1'));
  });

  it('picks are stable and in range', () => {
    const items = ['a', 'b', 'c', 'd'];
    const first = tickPick(ctx, 'target', items, 'creature-1');
    expect(items).toContain(first);
    expect(tickPick(ctx, 'target', items, 'creature-1')).toBe(first);
    expect(tickPick(ctx, 'target', [], 'creature-1')).toBeNull();
  });

  it('sequential streams replay identically for the same tick', () => {
    const runA = (() => {
      const rng = createTickRng(ctx, 'creature_pass', 'creature-1');
      return [rng.next(), rng.roll(6), rng.pick(['x', 'y', 'z']), rng.drawn];
    })();
    const runB = (() => {
      const rng = createTickRng(ctx, 'creature_pass', 'creature-1');
      return [rng.next(), rng.roll(6), rng.pick(['x', 'y', 'z']), rng.drawn];
    })();
    expect(runB).toEqual(runA);
    expect(runA[3]).toBe(3);
  });

  it('tank-pool selection is stable per creature and spreads across the pool', () => {
    const pool = [{ id: 'tank-a' }, { id: 'tank-b' }, { id: 'tank-c' }];
    expect(selectFromTankPool(ctx, 'creature-1', pool)).toEqual(
      selectFromTankPool(ctx, 'creature-1', pool),
    );
    const picks = new Set(
      Array.from({ length: 60 }, (_, i) =>
        selectFromTankPool({ encounterId: ENC, tickNumber: i }, 'creature-1', pool)?.id,
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
    expect(selectFromTankPool(ctx, 'creature-1', [])).toBeNull();
  });

  it('random_alive targeting seeded from the tick replays identically', () => {
    const candidates = [
      { id: 'p1', hp: 10 },
      { id: 'p2', hp: 10 },
      { id: 'p3', hp: 10 },
    ];
    const pickFor = () => selectPrimaryTarget(candidates, {
      mode: 'random_alive',
      pick: () => tickSample(ctx, 'creature_target', 'creature-1'),
    });
    expect(pickFor()?.id).toBe(pickFor()?.id);
  });

  it('a full resolution pass replayed after a lease expiry produces the same result', () => {
    const creatures = ['creature-1', 'creature-2'];
    const roster = [{ id: 'p1', hp: 20 }, { id: 'p2', hp: 20 }];

    const resolve = () =>
      creatures.map(cid => {
        const rng = createTickRng(ctx, 'creature_pass', cid);
        const target = selectPrimaryTarget(roster, { mode: 'random_alive', pick: () => rng.next() });
        return { cid, target: target?.id, damage: rng.roll(8), proc: rng.next() < 0.25 };
      });

    // attempt 1 (resolver A, died before commit) vs attempt 2 (resolver B)
    expect(resolve()).toEqual(resolve());
  });
});
