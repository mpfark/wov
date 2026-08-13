/**
 * C3 checkpoint 1 — contract golden tests.
 *
 * Three concerns, all pinned as rules rather than observed numbers:
 *   1. tick-time semantics (`active_effects.next_tick_at` == `nextTickAtMs`),
 *   2. derived progression (level-ups) inside the versioned contract,
 *   3. buff-key coverage: configuration may not produce an unregistered key.
 */

import { describe, expect, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure';
import { PROPOSED_TICK_VERSION, SNAPSHOT_VERSION } from '@/shared/combat/c2/contract';
import { BUFF_KEY_REGISTRY } from '@/shared/combat/c3/decode-snapshot';
import { getXpForLevel } from '@/shared/formulas/xp';
import { getClassLevelBonuses } from '@/shared/formulas/classes';
import { creature, participant, snapshot } from '../pure/fixtures';

const T0 = 1_700_000_000_000;

/** A bleed on the participant, due at `dueAt`, ticking every 2s. */
function bleed(dueAt: number, over: Record<string, unknown> = {}) {
  return {
    id: 'eff-bleed',
    targetKind: 'character' as const,
    targetId: 'char-1',
    effectType: 'bleed',
    isPeriodic: true,
    ampPct: 0,
    stacks: 1,
    amountPerTick: 5,
    expiresAtMs: T0 + 600_000,
    intervalMs: 2000,
    nextTickAtMs: dueAt,
    damageType: 'physical',
    sourceCharacterId: null,
    sourceCreatureId: 'creature-1',
    rowVersion: 1,
    ...over,
  };
}

describe('C3 contract — versions', () => {
  it('snapshot and proposal contracts are both at version 3', () => {
    expect(SNAPSHOT_VERSION).toBe(3);
    expect(PROPOSED_TICK_VERSION).toBe(3);
  });
});

describe('C3 contract — tick-time semantics', () => {
  it('a normal due tick fires once and advances the due time by one interval', () => {
    const out = resolveTickPure(
      snapshot({ nowMs: T0, ticksToSimulate: 1, effects: [bleed(T0)] }),
    );
    const upsert = out.effectUpserts.find((e) => e.effectType === 'bleed');
    expect(upsert?.nextTickAtMs).toBe(T0 + 2000);
  });

  it('a not-yet-due effect does not tick and keeps its due time untouched', () => {
    const out = resolveTickPure(
      snapshot({ nowMs: T0, ticksToSimulate: 1, effects: [bleed(T0 + 60_000)] }),
    );
    expect(out.effectUpserts.some((e) => e.effectType === 'bleed')).toBe(false);
    expect(out.events.some((e) => e.type === 'dot')).toBe(false);
  });

  it('a delayed invocation catches the effect up from its own due time, not from now', () => {
    // Due 3 intervals ago, one simulated tick: cadence follows the due time.
    const out = resolveTickPure(
      snapshot({ nowMs: T0, ticksToSimulate: 1, effects: [bleed(T0 - 6000)] }),
    );
    const upsert = out.effectUpserts.find((e) => e.effectType === 'bleed');
    expect(upsert?.nextTickAtMs).toBe(T0 - 4000);
  });

  it('a reclaimed tick is byte-identical: replaying the same snapshot repeats the schedule', () => {
    const snap = snapshot({ nowMs: T0, ticksToSimulate: 1, effects: [bleed(T0)] });
    const a = resolveTickPure(snap);
    const b = resolveTickPure(snap);
    expect(JSON.stringify(b.effectUpserts)).toBe(JSON.stringify(a.effectUpserts));
  });

  it('several elapsed catch-up ticks advance the schedule once per elapsed interval', () => {
    const out = resolveTickPure(
      snapshot({ mode: 'catchup', nowMs: T0, ticksToSimulate: 4, effects: [bleed(T0)] }),
    );
    const upsert = out.effectUpserts.find((e) => e.effectType === 'bleed');
    expect(upsert?.nextTickAtMs).toBe(T0 + 4 * 2000);
  });

  it('commit time and next due time are separate values with separate meanings', () => {
    const out = resolveTickPure(snapshot({ nowMs: T0, ticksToSimulate: 3 }));
    // resolvedAtMs: when this tick finished simulating (commit time).
    expect(out.resolvedAtMs).toBe(T0 + 3 * 2000);
    // session.nextDueAtMs: diagnostic presence only, never cadence authority.
    expect(out.session.nextDueAtMs).toBe(out.resolvedAtMs);
  });
});

describe('C3 contract — derived progression', () => {
  /** A one-shot kill so the tick always awards XP. */
  function killSnapshot(over: Parameters<typeof participant>[0]) {
    const lvl = (over as { level?: number })?.level ?? 12;
    return snapshot({
      participants: [participant({ ...over })],
      creatures: [creature({ hp: 1, level: lvl, rarity: 'boss' })],
      ticksToSimulate: 8,
      nowMs: T0,
    });
  }

  it('ordinary XP below the threshold emits no progression row', () => {
    const out = resolveTickPure(
      killSnapshot({ level: 40, xp: 0, unspentStatPoints: 0 }),
    );
    expect(out.rewards.length).toBeGreaterThan(0);
    expect(out.progression).toHaveLength(0);
  });

  it('one level-up carries the XP remainder, refilled HP and recalculated maxima', () => {
    const level = 10;
    const nearly = getXpForLevel(level) - 1;
    const out = resolveTickPure(
      killSnapshot({ level, xp: nearly, hp: 40, unspentStatPoints: 2 }),
    );
    const gained = out.rewards.reduce((n, r) => n + r.xp, 0);
    expect(gained).toBeGreaterThan(0);
    const row = out.progression[0];
    expect(row.levelBefore).toBe(level);
    expect(row.levelAfter).toBe(level + 1);
    expect(row.xpAfter).toBe(nearly + gained - getXpForLevel(level));
    expect(row.hpAfter).toBe(row.maxHpAfter); // level-up refills HP
    expect(row.unspentStatPointsDelta).toBe(1);
    expect(row.maxHpAfter).toBeGreaterThan(0);
    expect(row.cpAfter).toBeLessThanOrEqual(row.maxCpAfter);
    expect(row.mpAfter).toBeLessThanOrEqual(row.maxMpAfter);
  });

  it('a level divisible by three grants the configured class attribute bonuses', () => {
    const level = 11; // -> 12
    const out = resolveTickPure(
      killSnapshot({ level, xp: getXpForLevel(level) - 1, classKey: 'warrior' }),
    );
    const row = out.progression[0];
    expect(row.levelAfter).toBe(12);
    expect(row.attributeDeltas).toEqual(getClassLevelBonuses('warrior'));
  });

  it('a non-milestone level grants no class bonus and no respec point', () => {
    const level = 12; // -> 13
    const out = resolveTickPure(
      killSnapshot({ level, xp: getXpForLevel(level) - 1 }),
    );
    const row = out.progression[0];
    expect(row.levelAfter).toBe(13);
    expect(row.attributeDeltas).toEqual({});
    expect(row.respecPointsDelta).toBe(0);
  });

  it('respec-point levels (10/20/30/40) grant exactly one respec point', () => {
    for (const target of [10, 20, 30, 40]) {
      const level = target - 1;
      const out = resolveTickPure(
        killSnapshot({ level, xp: getXpForLevel(level) - 1 }),
      );
      const row = out.progression[0];
      expect(row.levelAfter).toBe(target);
      expect(row.respecPointsDelta).toBe(1);
    }
  });

  it('level 42 is the cap: XP is reset to zero and the level never advances', () => {
    const out = resolveTickPure(
      killSnapshot({ level: 42, xp: 5, unspentStatPoints: 0 }),
    );
    const row = out.progression[0];
    expect(row.levelBefore).toBe(42);
    expect(row.levelAfter).toBe(42);
    expect(row.xpAfter).toBe(0);
    expect(row.unspentStatPointsDelta).toBe(0);
    expect(row.attributeDeltas).toEqual({});
  });

  it('at most one level is gained per tick, whatever the XP haul', () => {
    const out = resolveTickPure(
      killSnapshot({ level: 2, xp: getXpForLevel(2) - 1 }),
    );
    for (const row of out.progression) {
      expect(row.levelAfter - row.levelBefore).toBeLessThanOrEqual(1);
    }
  });
});

describe('C3 contract — buff key coverage', () => {
  it('every combat-relevant buff key produced by configuration is registered', () => {
    // Inventory of keys the game can write into `characters.reserved_buffs`
    // and `characters.stance_state` through abilities, items, effects and
    // stance configuration. Add here *and* to the registry when new keys ship.
    const producedKeys = [
      'stealth',
      'damage_buff',
      'ignite',
      'envenom',
      'mitigation_pct',
      'mitigation_flat',
      'absorb_shield',
      'dodge_chance',
      'crit_buff',
      'block_buff',
      'rooted',
    ];
    const unregistered = producedKeys.filter((k) => !(k in BUFF_KEY_REGISTRY));
    expect(unregistered).toEqual([]);
  });

  it('every registry entry maps onto a real participant buff field', () => {
    const fields = new Set(Object.keys(participant().buffs));
    for (const target of Object.values(BUFF_KEY_REGISTRY)) {
      expect(fields.has(target)).toBe(true);
    }
  });
});
