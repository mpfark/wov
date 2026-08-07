/**
 * Resolver-level Chilled behaviour: player DoTs are amplified, non-periodic
 * statuses never tick and expire on their own window, and bulk (offscreen)
 * mode resolves amplification per simulated historical tick.
 */
import { describe, it, expect } from 'vitest';
import { resolveEffectTicks } from '@/features/combat';
import { expiryFromTicks, type DamageAmpStatusDef } from '@/shared/combat/creature-damage-modifiers';

const TICK = 2000;

const chilled: DamageAmpStatusDef & { label?: string } = {
  key: 'chilled', effect_type: 'chilled', classification: 'damage_amp',
  label: 'Chilled',
  modifier: { kind: 'damage_taken_pct', value: 10, eligible_sources: ['weapon', 'ability', 'stance', 'dot', 'proc'] },
};
const poisonDef: DamageAmpStatusDef = {
  key: 'poison', effect_type: 'poison', classification: 'dot', modifier: null,
};
const statusDefs = { chilled, poison: poisonDef } as Record<string, DamageAmpStatusDef>;

const creature = () => ({
  id: 'cr1', name: 'Goblin', node_id: 'node1', level: 5, rarity: 'regular',
  loot_table_id: null, loot_table: [], drop_chance: 0.5, is_humanoid: true,
});

const dot = (over: Record<string, unknown> = {}) => ({
  id: 'eff1', source_id: 'char1', target_id: 'cr1', effect_type: 'poison',
  damage_per_tick: 5, stacks: 2, tick_rate_ms: TICK,
  next_tick_at: 10_000, expires_at: 30_000, node_id: 'node1', ...over,
});

const chillRow = (over: Record<string, unknown> = {}) => ({
  id: 'amp1', source_id: 'char1', target_id: 'cr1', effect_type: 'chilled',
  damage_per_tick: 0, stacks: 1, tick_rate_ms: TICK,
  next_tick_at: null, started_at: 8_000,
  expires_at: expiryFromTicks(8_000, 3, TICK), node_id: 'node1', ...over,
});

describe('resolveEffectTicks — Chilled amplifies player DoTs', () => {
  it('amplifies the DoT tick when the snapshot has Chilled active', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const snapshot = {
      cr1: [{
        statusKey: 'chilled', pct: 10,
        eligibleSources: ['dot'] as any, startedAt: 8_000, expiresAt: 99_999,
      }],
    };
    resolveEffectTicks([dot()], cHp, new Set(), [creature()], 30, {
      tickTime: 10_000, memberNameMap: { char1: 'Hero' },
      amp: { snapshot }, statusDefs,
    });
    // 2 stacks x 5 = 10 -> +10% = 11
    expect(cHp['cr1']).toBe(89);
  });

  it('leaves the DoT untouched with no amplification', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    resolveEffectTicks([dot()], cHp, new Set(), [creature()], 30, {
      tickTime: 10_000, memberNameMap: { char1: 'Hero' }, statusDefs,
    });
    expect(cHp['cr1']).toBe(90);
  });
});

describe('resolveEffectTicks — non-periodic statuses', () => {
  it('never ticks damage and never advances a cadence', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const row = chillRow();
    const result = resolveEffectTicks([row], cHp, new Set(), [creature()], 30, {
      tickTime: 10_000, statusDefs,
    });
    expect(cHp['cr1']).toBe(100);
    expect(result.advancedEffects).toHaveLength(0);
    expect(result.expiredIds).toHaveLength(0);
  });

  it('expires once its tick window closes, emitting a fade event', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const row = chillRow();
    const result = resolveEffectTicks([row], cHp, new Set(), [creature()], 30, {
      tickTime: row.expires_at, statusDefs,
    });
    expect(result.expiredIds).toEqual(['amp1']);
    expect(result.events[0].message).toContain('Chilled');
    expect(result.clearedDots[0].dot_type).toBe('chilled');
  });

  it('covers exactly three combat ticks', () => {
    const row = chillRow();
    const live = [1, 2, 3].map(n => resolveEffectTicks(
      [chillRow()], { cr1: 100 }, new Set(), [creature()], 30,
      { tickTime: row.started_at + n * TICK, statusDefs },
    ).expiredIds.length);
    expect(live).toEqual([0, 0, 0]);
    const fourth = resolveEffectTicks(
      [chillRow()], { cr1: 100 }, new Set(), [creature()], 30,
      { tickTime: row.started_at + 4 * TICK, statusDefs },
    );
    expect(fourth.expiredIds).toEqual(['amp1']);
  });
});

describe('resolveEffectTicks — bulk (offscreen) mode', () => {
  it('amplifies only the historical ticks inside the Chilled window', () => {
    const cHp: Record<string, number> = { cr1: 200 };
    const effects = [
      dot({ next_tick_at: 10_000, expires_at: 18_000 }),
      chillRow({ started_at: 10_000, expires_at: expiryFromTicks(10_000, 1, TICK) }),
    ];
    resolveEffectTicks(effects, cHp, new Set(), [creature()], 30, {
      now: 20_000,
      amp: { effects, defs: statusDefs },
      statusDefs,
    });
    // Ticks land at 10k,12k,14k,16k,18k (5 ticks of 10 base damage). The
    // Chilled window is [10k, 13k) — a one-tick duration plus the half-tick
    // jitter margin — so exactly the 10k and 12k ticks are amplified.
    expect(cHp['cr1']).toBe(200 - (11 + 11 + 10 + 10 + 10));
  });
});
