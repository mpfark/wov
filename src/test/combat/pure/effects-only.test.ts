/**
 * `mode: 'catchup'` (effects-only) capability invariants.
 *
 * Effects-only may only advance already persisted state. It is a hard
 * restriction inside `resolveTickPure`, not a convention of the caller: no
 * player attack, no creature attack, no pending-action consumption, no new boss
 * cast and no durability change may ever come out of an effects-only tick —
 * while an offscreen damage-over-time kill and its exactly-once reward must
 * still work.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import type { EncounterSnapshot } from '@/shared/combat/pure/types';
import { randomSnapshot, snapshot, participant, creature } from './fixtures';

const PLAYER_ATTACK_EVENTS = new Set([
  'autoattack_hit',
  'autoattack_crit',
  'autoattack_miss',
  'ability_hit',
  'ability_crit',
  'ability_miss',
  'debuff',
  'debuff_miss',
]);

const CREATURE_ATTACK_EVENTS = new Set([
  'creature_hit',
  'creature_crit',
  'creature_miss',
  'dodge',
  'block',
  'holy_shield_return',
]);

function counters(tick: ReturnType<typeof resolveTickPure>) {
  return {
    playerAttacks: tick.events.filter((e) => PLAYER_ATTACK_EVENTS.has(e.type)).length,
    creatureAttacks: tick.events.filter((e) => CREATURE_ATTACK_EVENTS.has(e.type)).length,
    actionsConsumed: tick.consumedActionIds.length + tick.rejectedActions.length,
    newCasts: tick.casts.filter((c) => c.phase === 'start').length,
    durability: tick.durability.length,
    dotTicks: tick.events.filter((e) => e.type === 'dot_tick').length,
    channelBanks: tick.events.filter((e) => e.type === 'boss_cast_channel').length,
  };
}

describe('effects-only capability invariants', () => {
  it('performs no active combat across a 4,000-encounter sweep', () => {
    let dotTicks = 0;
    let expiries = 0;
    let deaths = 0;
    let rewards = 0;

    for (let seed = 1; seed <= 4000; seed++) {
      const live = randomSnapshot(seed);
      const sweep: EncounterSnapshot = { ...live, mode: 'catchup', ticksToSimulate: 3 };
      const tick = resolveTickPure(sweep);
      const c = counters(tick);

      expect(c.playerAttacks, `seed ${seed} player attacks`).toBe(0);
      expect(c.creatureAttacks, `seed ${seed} creature attacks`).toBe(0);
      expect(c.actionsConsumed, `seed ${seed} actions consumed`).toBe(0);
      expect(c.newCasts, `seed ${seed} new boss casts`).toBe(0);
      expect(c.durability, `seed ${seed} durability changes`).toBe(0);
      expect(c.channelBanks, `seed ${seed} stored-power banking`).toBe(0);
      expect(tick.mode).toBe('catchup');

      dotTicks += c.dotTicks;
      expiries += tick.effectDeleteIds.length;
      deaths += tick.kills.length;
      rewards += tick.rewards.length;
    }

    // The sweep must not be vacuously clean: persisted progression still runs.
    expect(dotTicks).toBeGreaterThan(0);
    expect(expiries).toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(0);
    expect(rewards).toBeGreaterThan(0);
    // Isolation guard: a 4,000-encounter sweep is compute-bound and shares the
    // machine with the other parity sweeps, so it gets an explicit budget
    // instead of the 5s default (same class of flake as the eviscerate sweep).
  }, 60_000);

  it('kills offscreen with a due DoT and rewards the source exactly once', () => {
    const p = participant({ id: 'char-1' });
    const c = creature({ id: 'crt-1', hp: 4, maxHp: 90 });
    const base = snapshot({
      participants: [p],
      creatures: [c],
      effects: [
        {
          id: 'eff-1',
          targetKind: 'creature',
          targetId: c.id,
          effectType: 'bleed',
          stacks: 2,
          amountPerTick: 6,
          expiresAtMs: 1_700_000_020_000,
          intervalMs: 2000,
          nextTickAtMs: 1_699_999_998_000,
          damageType: 'physical',
          sourceCharacterId: p.id,
          isPeriodic: true,
          ampPct: 0,
        },
      ],
      actions: [],
      mode: 'catchup',
      ticksToSimulate: 4,
    });

    const tick = resolveTickPure(base);
    const cnt = counters(tick);

    expect(cnt.playerAttacks).toBe(0);
    expect(cnt.creatureAttacks).toBe(0);
    expect(cnt.newCasts).toBe(0);
    expect(cnt.durability).toBe(0);
    expect(tick.kills.map((k) => k.creatureId)).toEqual(['crt-1']);
    expect(tick.kills).toHaveLength(1);
    expect(tick.rewards.filter((r) => r.characterId === p.id)).toHaveLength(1);
  });

  it('leaves a pending action pending instead of executing or rejecting it', () => {
    const live = randomSnapshot(7);
    const withAction: EncounterSnapshot = {
      ...live,
      mode: 'catchup',
      actions: live.actions.length > 0 ? live.actions : randomSnapshot(11).actions,
    };
    const tick = resolveTickPure(withAction);
    expect(tick.consumedActionIds).toEqual([]);
    expect(tick.rejectedActions).toEqual([]);
  });

  it('runs the same encounter with real activity in live mode', () => {
    // Guards against a false pass from an empty fixture: the identical snapshot
    // in live mode must actually attack.
    let liveAttacks = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const tick = resolveTickPure({ ...randomSnapshot(seed), mode: 'live' });
      liveAttacks += counters(tick).playerAttacks + counters(tick).creatureAttacks;
    }
    expect(liveAttacks).toBeGreaterThan(0);
  });
});
