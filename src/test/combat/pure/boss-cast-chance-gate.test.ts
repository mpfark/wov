/**
 * The per-tick boss-cast start chance.
 *
 * Restored from the pre-C3 handler, which rolled once per tick after the
 * cooldown and target checks. Without it every boss telegraphs on a fixed
 * metronome. The roll must be deterministic (same tick -> same decision, so
 * live, catch-up and lease retries agree) and must mutate nothing when it
 * fails.
 */
import { describe, expect, it } from 'vitest';
import {
  bossCastNeedsChanceRoll,
  resolveTickPure,
  stepBossCastSchedule,
} from '@/shared/combat/pure';
import { creature, participant, snapshot } from './fixtures';
import type { BossCastSnapshot } from '@/shared/combat/pure/types';

const cast = (over: Partial<BossCastSnapshot> = {}): BossCastSnapshot => ({
  abilityKey: 'ruinous_decree',
  castKey: 'ruinous_decree',
  label: 'Ruinous Decree',
  castTicks: 2,
  cooldownTicks: 5,
  damage: 40,
  damageAoe: 10,
  damageType: 'arcane',
  targetMode: 'tank_preferred',
  chance: 1,
  channeling: false,
  storedPowerCap: 0,
  primaryShare: 1,
  aoeShare: 0.4,
  consumeMode: 'all',
  consumePct: 100,
  consumeFixed: 0,
  pauseAutoattacks: false,
  lockMs: 0,
  castingText: null,
  castedText: null,
  ...over,
});

/**
 * A long-lived target and a one-tick cast/cooldown so the boss gets a fresh
 * start opportunity on (almost) every simulated tick — otherwise channel time
 * and cooldown, not the gate, would decide the count.
 */
function starts(chance: number, ticks = 1) {
  return resolveTickPure(
    snapshot({
      participants: [participant({ hp: 500_000, maxHp: 500_000 })],
      creatures: [
        creature({
          rarity: 'boss',
          hp: 500_000,
          maxHp: 500_000,
          bossCast: cast({ chance, castTicks: 1, cooldownTicks: 1 }),
        }),
      ],
      ticksToSimulate: ticks,
    }),
  );
}

describe('boss cast — per-tick start chance', () => {
  it('always starts at chance 1', () => {
    const out = starts(1);
    expect(out.events.some((e) => e.type === 'boss_cast_start')).toBe(true);
  });

  it('never starts at chance 0, and consumes no cooldown', () => {
    const out = starts(0, 4);
    expect(out.events.some((e) => e.type === 'boss_cast_start')).toBe(false);
    // A refused roll leaves nothing behind: no channel, so nothing resolves.
    expect(out.events.some((e) => e.type.startsWith('boss_cast'))).toBe(false);
    expect(out.casts ?? []).toHaveLength(0);
  });

  it('is deterministic: the same tick resolves the same way every time', () => {
    const decide = () =>
      starts(0.3, 6).events.filter((e) => e.type === 'boss_cast_start').length;
    const first = decide();
    expect(decide()).toBe(first);
    expect(decide()).toBe(first);
  });

  it('a partial chance gates some start opportunities but not all', () => {
    const count = (chance: number) =>
      starts(chance, 120).events.filter((e) => e.type === 'boss_cast_start').length;
    const always = count(1);
    const half = count(0.5);
    expect(always).toBeGreaterThan(10);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(always);
  });
});

// ── The gate as a state step ────────────────────────────────────────────────
// The resolver's cooldown ledger is internal working state, so these assert the
// transition directly rather than inferring it from a missing event.

const gate = (over: Partial<Parameters<typeof stepBossCastSchedule>[0]> = {}) =>
  stepBossCastSchedule({
    channeling: false,
    cooldownTicks: 0,
    hasTarget: true,
    chance: 1,
    roll: null,
    configuredCooldownTicks: 10,
    ...over,
  });

describe('boss cast — gate state transitions', () => {
  it('freezes the cooldown while a cast is channeling', () => {
    expect(gate({ channeling: true, cooldownTicks: 10 })).toEqual({
      outcome: 'channeling',
      cooldownTicksAfter: 10,
    });
    expect(gate({ channeling: true, cooldownTicks: 0 }).cooldownTicksAfter).toBe(0);
  });

  it('counts the cooldown down only from resolution, one tick at a time', () => {
    let cd = gate().cooldownTicksAfter;
    expect(cd).toBe(10);
    const seen: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const step = gate({ cooldownTicks: cd });
      expect(step.outcome).toBe('cooling_down');
      cd = step.cooldownTicksAfter;
      seen.push(cd);
    }
    expect(seen).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(gate({ cooldownTicks: cd }).outcome).toBe('start');
  });

  it('always spends at least one cooldown tick, even if authored as zero', () => {
    expect(gate({ configuredCooldownTicks: 0 }).cooldownTicksAfter).toBe(1);
    expect(gate({ configuredCooldownTicks: -5 }).cooldownTicksAfter).toBe(1);
  });

  it('a refused roll leaves the cooldown untouched and stays eligible', () => {
    const refused = gate({ chance: 0.2, roll: 0.9 });
    expect(refused).toEqual({ outcome: 'refused', cooldownTicksAfter: 0 });
    // Next tick, same state, a passing roll starts immediately.
    expect(gate({ chance: 0.2, roll: 0.1 }).outcome).toBe('start');
  });

  it('checks the chance only after cooldown and target selection', () => {
    expect(gate({ cooldownTicks: 3, chance: 1, hasTarget: false }).outcome).toBe('cooling_down');
    expect(gate({ hasTarget: false, chance: 1 })).toEqual({
      outcome: 'no_target',
      cooldownTicksAfter: 0,
    });
  });

  it('draws randomness only for a genuinely uncertain chance', () => {
    expect(bossCastNeedsChanceRoll(0)).toBe(false);
    expect(bossCastNeedsChanceRoll(1)).toBe(false);
    expect(bossCastNeedsChanceRoll(0.5)).toBe(true);
    // With no roll supplied, the certain cases still decide correctly.
    expect(gate({ chance: 0, roll: null }).outcome).toBe('refused');
    expect(gate({ chance: 1, roll: null }).outcome).toBe('start');
  });

  it('treats the boundary roll as a pass', () => {
    expect(gate({ chance: 0.25, roll: 0.25 }).outcome).toBe('start');
    expect(gate({ chance: 0.25, roll: 0.2500001 }).outcome).toBe('refused');
  });
});

describe('boss cast — the gate does not disturb the rest of the tick', () => {
  /** Same fixture, one with a gated cast, one with no cast at all. */
  const run = (bossCast: BossCastSnapshot | null) =>
    resolveTickPure(
      snapshot({
        participants: [participant({ hp: 500_000, maxHp: 500_000 })],
        creatures: [
          creature({
            rarity: 'boss',
            hp: 500_000,
            maxHp: 500_000,
            bossCast: bossCast ?? undefined,
          }),
        ],
        ticksToSimulate: 30,
      }),
    );

  it('a fully refused cast leaves autoattacks byte-identical to no cast', () => {
    const withGate = run(cast({ chance: 0, castTicks: 1, cooldownTicks: 1 }));
    const without = run(null);
    const attacks = (out: ReturnType<typeof run>) =>
      out.events.filter((e) => e.type.startsWith('autoattack')).map((e) => JSON.stringify(e));
    expect(attacks(withGate)).toEqual(attacks(without));
    expect(withGate.events.some((e) => e.type.startsWith('boss_cast'))).toBe(false);
  });

  it('replays an identical cast/no-cast sequence for a fixed seed', () => {
    const sequence = () =>
      starts(0.35, 60)
        .events.filter((e) => e.type === 'boss_cast_start')
        .map((e) => (e as { tick?: number }).tick ?? -1);
    const first = sequence();
    expect(sequence()).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});
