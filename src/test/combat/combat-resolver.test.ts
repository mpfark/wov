import { describe, it, expect } from 'vitest';
import { resolveEffectTicks } from '@/lib/combat-resolver';

// ── Helpers ──────────────────────────────────────────────────────

function makeCreature(overrides: Partial<any> = {}) {
  return {
    id: 'cr1',
    name: 'Goblin',
    node_id: 'node1',
    level: 5,
    rarity: 'regular',
    loot_table_id: null,
    loot_table: [],
    drop_chance: 0.5,
    is_humanoid: true,
    ...overrides,
  };
}

function makeEffect(overrides: Partial<any> = {}) {
  return {
    id: 'eff1',
    source_id: 'char1',
    target_id: 'cr1',
    effect_type: 'poison',
    damage_per_tick: 5,
    stacks: 2,
    tick_rate_ms: 2000,
    next_tick_at: 10000,
    expires_at: 20000,
    node_id: 'node1',
    ...overrides,
  };
}

// ── Single-tick mode tests ───────────────────────────────────────

describe('resolveEffectTicks — single-tick mode', () => {
  it('applies correct poison damage (stacks * damage_per_tick)', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const cKilled = new Set<string>();
    const eff = makeEffect(); // 2 stacks * 5 = 10 dmg

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { tickTime: 10000, memberNameMap: { char1: 'Hero' } },
    );

    expect(cHp['cr1']).toBe(90);
    expect(result.advancedEffects).toHaveLength(1);
    expect(result.advancedEffects[0].next_tick_at).toBe(12000);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].message).toContain('2 stacks');
  });

  it('bleed uses flat damage_per_tick (ignores stacks)', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const cKilled = new Set<string>();
    const eff = makeEffect({ effect_type: 'bleed', stacks: 5, damage_per_tick: 8 });

    resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { tickTime: 10000 },
    );

    expect(cHp['cr1']).toBe(92); // 100 - 8, not 100 - 40
  });

  it('expires effect when tickTime >= expires_at', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const cKilled = new Set<string>();
    const eff = makeEffect({ expires_at: 10000 });

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { tickTime: 10000 },
    );

    expect(cHp['cr1']).toBe(100); // No damage applied
    expect(result.expiredIds).toContain('eff1');
    expect(result.clearedDots).toHaveLength(1);
  });

  it('kills creature when HP reaches 0', () => {
    const cHp: Record<string, number> = { cr1: 8 };
    const cKilled = new Set<string>();
    const eff = makeEffect(); // 10 dmg total

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { tickTime: 10000 },
    );

    expect(cHp['cr1']).toBe(0);
    expect(cKilled.has('cr1')).toBe(true);
    expect(result.newKills.has('cr1')).toBe(true);
  });

  it('skips already-dead creatures', () => {
    const cHp: Record<string, number> = { cr1: 0 };
    const cKilled = new Set<string>(['cr1']);
    const eff = makeEffect();

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { tickTime: 10000 },
    );

    expect(cHp['cr1']).toBe(0);
    expect(result.advancedEffects).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it('does not tick when effect is not yet due', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const cKilled = new Set<string>();
    const eff = makeEffect({ next_tick_at: 15000 });

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { tickTime: 10000 },
    );

    expect(cHp['cr1']).toBe(100);
    expect(result.advancedEffects).toHaveLength(0);
  });
});

// ── Bulk mode tests ──────────────────────────────────────────────

describe('resolveEffectTicks — bulk mode', () => {
  it('processes multiple elapsed ticks', () => {
    const cHp: Record<string, number> = { cr1: 100 };
    const cKilled = new Set<string>();
    // 3 ticks elapsed: at 10000, 12000, 14000
    const eff = makeEffect({ next_tick_at: 10000, expires_at: 30000 });

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { now: 14500 },
    );

    // 3 ticks * 10 dmg = 30
    expect(cHp['cr1']).toBe(70);
    expect(result.advancedEffects).toHaveLength(1);
    expect(result.advancedEffects[0].next_tick_at).toBe(16000); // 10000 + 3*2000
  });

  it('respects tick cap', () => {
    const cHp: Record<string, number> = { cr1: 1000 };
    const cKilled = new Set<string>();
    // Many ticks elapsed but cap = 5
    const eff = makeEffect({ next_tick_at: 0, expires_at: 100000, damage_per_tick: 1, stacks: 1 });

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 5,
      { now: 50000 },
    );

    // Only 5 ticks * 1 dmg = 5
    expect(cHp['cr1']).toBe(995);
    expect(result.advancedEffects[0].next_tick_at).toBe(10000); // 0 + 5*2000
  });

  it('stops ticking when creature dies mid-bulk', () => {
    const cHp: Record<string, number> = { cr1: 15 };
    const cKilled = new Set<string>();
    // 10 ticks available but creature dies after 2 (2*10=20 > 15)
    const eff = makeEffect({ next_tick_at: 10000, expires_at: 50000 });

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { now: 30000 },
    );

    expect(cHp['cr1']).toBe(0);
    expect(result.newKills.has('cr1')).toBe(true);
    expect(result.expiredIds).toContain('eff1'); // Cleaned up since target died
  });

  it('expires effect when all ticks reach expires_at', () => {
    const cHp: Record<string, number> = { cr1: 1000 };
    const cKilled = new Set<string>();
    // expires_at allows exactly 3 ticks: at 10000, 12000, 14000
    const eff = makeEffect({ next_tick_at: 10000, expires_at: 15000 });

    const result = resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { now: 20000 },
    );

    // 3 ticks * 10 dmg = 30
    expect(cHp['cr1']).toBe(970);
    // newNextTickAt = 10000 + 3*2000 = 16000 >= expires_at(15000), so expired
    expect(result.expiredIds).toContain('eff1');
  });

  it('advances next_tick_at deterministically', () => {
    const cHp: Record<string, number> = { cr1: 1000 };
    const cKilled = new Set<string>();
    const eff = makeEffect({ next_tick_at: 5000, expires_at: 50000, tick_rate_ms: 3000 });

    resolveEffectTicks(
      [eff], cHp, cKilled, [makeCreature()], 30,
      { now: 12000 },
    );

    // ticks: at 5000, 8000, 11000 → 3 ticks → next = 5000 + 3*3000 = 14000
    expect(eff.next_tick_at).toBe(14000);
  });
});
