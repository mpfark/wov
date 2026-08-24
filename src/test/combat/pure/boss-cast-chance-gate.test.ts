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
import { resolveTickPure } from '@/shared/combat/pure';
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
    // A refused roll leaves the boss eligible: no cast row, no channel state.
    expect(out.creatures[0].castCooldownTicksAfter ?? 0).toBe(0);
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
