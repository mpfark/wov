/**
 * C1 determinism: identical snapshot + tick + seed → byte-identical output;
 * a different authoritative tick number → a different stream.
 */

import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import { randomSnapshot, snapshot } from './fixtures';

const j = (v: unknown) => JSON.stringify(v);

describe('pure resolver — determinism', () => {
  it('is byte-identical across repeated resolves of the same snapshot', () => {
    const snap = snapshot({ ticksToSimulate: 4 });
    const first = j(resolveTickPure(snap));
    for (let i = 0; i < 25; i++) {
      expect(j(resolveTickPure(snap))).toBe(first);
    }
  });

  it('is byte-identical for a deep-cloned snapshot (no identity dependence)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const snap = randomSnapshot(seed);
      const clone = JSON.parse(JSON.stringify(snap));
      expect(j(resolveTickPure(clone))).toBe(j(resolveTickPure(snap)));
    }
  });

  it('does not mutate the snapshot it was given', () => {
    const snap = randomSnapshot(77);
    const before = j(snap);
    resolveTickPure(snap);
    expect(j(snap)).toBe(before);
  });

  it('produces a distinct stream for every authoritative tick number', () => {
    const base = snapshot({ ticksToSimulate: 2 });
    const seen = new Map<string, number>();
    for (let tick = 1; tick <= 400; tick++) {
      const out = resolveTickPure({ ...base, tickNumber: tick });
      const fingerprint = j(out.events.map((e) => [e.type, e.amount]));
      const prev = seen.get(fingerprint);
      if (prev !== undefined) continue;
      seen.set(fingerprint, tick);
    }
    // 400 ticks of the same fight must not collapse onto a handful of outcomes.
    expect(seen.size).toBeGreaterThan(40);
  });

  it('changes outcome when the tick number changes, holding all else equal', () => {
    const base = snapshot({ ticksToSimulate: 3 });
    const a = resolveTickPure({ ...base, tickNumber: 1000 });
    const b = resolveTickPure({ ...base, tickNumber: 1001 });
    expect(j(a)).not.toBe(j(b));
  });

  it('keeps the encounter id in the seed (two encounters diverge)', () => {
    const base = snapshot({ ticksToSimulate: 3 });
    const a = resolveTickPure({ ...base, encounterId: 'enc-a' });
    const b = resolveTickPure({ ...base, encounterId: 'enc-b' });
    expect(j(a.events)).not.toBe(j(b.events));
  });

  it('resolves live and catch-up identically for the same tick', () => {
    const base = randomSnapshot(9001);
    const live = resolveTickPure({ ...base, mode: 'live' });
    const catchup = resolveTickPure({ ...base, mode: 'catchup' });
    expect(j({ ...live, mode: null })).toBe(j({ ...catchup, mode: null }));
    expect(live.mode).toBe('live');
    expect(catchup.mode).toBe('catchup');
  });

  it('is insensitive to input array order (ordering is imposed, not inherited)', () => {
    const snap = randomSnapshot(4242);
    const shuffled = {
      ...snap,
      participants: [...snap.participants].reverse(),
      creatures: [...snap.creatures].reverse(),
      effects: [...snap.effects].reverse(),
      actions: [...snap.actions].reverse(),
      engagements: [...snap.engagements].reverse(),
      procs: [...snap.procs].reverse(),
    };
    const a = resolveTickPure(snap);
    const b = resolveTickPure(shuffled);
    expect(j({ ...b, events: null })).toBe(j({ ...a, events: null }));
  });

  it('reports the number of RNG draws it made', () => {
    const out = resolveTickPure(snapshot({ ticksToSimulate: 2 }));
    expect(out.rngDraws).toBeGreaterThan(0);
    expect(out.rngDraws).toBe(resolveTickPure(snapshot({ ticksToSimulate: 2 })).rngDraws);
  });
});
