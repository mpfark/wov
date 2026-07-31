import { describe, it, expect } from 'vitest';
import { resolveDamage, resolveHeal } from '../resolution';
import { selectPrimaryTarget, selectAoeTargets, livingTargets } from '../targeting';
import { applyStackingEffect, isEffectExpired } from '../status';
import { buildCastHitMessages, buildCastHitEvent } from '@shared/combat/cast-events';

describe('resolveDamage', () => {
  it('applies damage and clamps at zero HP', () => {
    const r = resolveDamage({ amount: 30, hp: 12 });
    expect(r.applied).toBe(12);
    expect(r.hpAfter).toBe(0);
    expect(r.killed).toBe(true);
  });

  it('soaks into a ward before HP', () => {
    const r = resolveDamage({ amount: 10, hp: 40, shield: 6 });
    expect(r).toMatchObject({ absorbed: 6, applied: 4, hpAfter: 36, shieldAfter: 0, killed: false });
  });

  it('never revives, never reports a kill on an already-dead target', () => {
    const r = resolveDamage({ amount: 5, hp: 0 });
    expect(r.applied).toBe(0);
    expect(r.killed).toBe(false);
  });

  it('clamps junk input instead of producing NaN', () => {
    expect(resolveDamage({ amount: Number.NaN, hp: 10 }).applied).toBe(0);
    expect(resolveDamage({ amount: -7, hp: 10 }).hpAfter).toBe(10);
  });
});

describe('resolveHeal', () => {
  it('reports the real delta and overheal', () => {
    const r = resolveHeal({ amount: 20, hp: 45, maxHp: 50 });
    expect(r).toMatchObject({ applied: 5, overheal: 15, hpAfter: 50 });
  });

  it('does not resurrect the fallen', () => {
    const r = resolveHeal({ amount: 50, hp: 0, maxHp: 80 });
    expect(r).toMatchObject({ applied: 0, hpAfter: 0 });
  });

  it('matches the old inline min(before+amt, max) math', () => {
    for (const hp of [1, 17, 49, 50]) {
      const expected = Math.min(hp + 7, 50) - hp;
      expect(resolveHeal({ amount: 7, hp, maxHp: 50 }).applied).toBe(expected);
    }
  });
});

describe('targeting', () => {
  const party = [
    { id: 'tank', hp: 30 },
    { id: 'healer', hp: 22 },
    { id: 'dps', hp: 0 },
  ];

  it('filters the dead', () => {
    expect(livingTargets(party).map(m => m.id)).toEqual(['tank', 'healer']);
  });

  it('tank_strict hits only a living tank', () => {
    expect(selectPrimaryTarget(party, { mode: 'tank_strict', tankId: 'tank' })?.id).toBe('tank');
    expect(selectPrimaryTarget(party, { mode: 'tank_strict', tankId: 'dps' })).toBeNull();
    expect(selectPrimaryTarget(party, { mode: 'tank_strict', tankId: null })).toBeNull();
  });

  it('tank_preferred falls back to the first living member', () => {
    expect(selectPrimaryTarget(party, { mode: 'tank_preferred', tankId: 'dps' })?.id).toBe('tank');
    expect(selectPrimaryTarget(party, { mode: 'tank_preferred', tankId: null })?.id).toBe('tank');
    expect(selectPrimaryTarget([{ id: 'x', hp: 0 }], { mode: 'tank_preferred' })).toBeNull();
  });

  it('random_alive matches alive[floor(roll * n)] and never overflows', () => {
    expect(selectPrimaryTarget(party, { mode: 'random_alive', pick: () => 0 })?.id).toBe('tank');
    expect(selectPrimaryTarget(party, { mode: 'random_alive', pick: () => 0.99 })?.id).toBe('healer');
    expect(selectPrimaryTarget(party, { mode: 'random_alive', pick: () => 1 })?.id).toBe('healer');
  });

  it('AoE targets every living candidate, minus an exclusion', () => {
    expect(selectAoeTargets(party).map(m => m.id)).toEqual(['tank', 'healer']);
    expect(selectAoeTargets(party, { excludeId: 'tank' }).map(m => m.id)).toEqual(['healer']);
  });
});

describe('applyStackingEffect', () => {
  it('starts at one stack and schedules the first tick', () => {
    const s = applyStackingEffect(null, {
      now: 1000, durationMs: 20000, damagePerTick: 4, maxStacks: 5, tickRateMs: 3000,
    });
    expect(s).toEqual({
      stacks: 1, damage_per_tick: 4, next_tick_at: 4000, expires_at: 21000, tick_rate_ms: 3000,
    });
  });

  it('stacks up to the cap and preserves cadence on refresh', () => {
    let s = applyStackingEffect(null, { now: 0, durationMs: 10000, damagePerTick: 2, maxStacks: 3, tickRateMs: 3000 });
    for (let i = 0; i < 5; i++) {
      s = applyStackingEffect(s, { now: 6000, durationMs: 10000, damagePerTick: 2, maxStacks: 3, tickRateMs: 3000 });
    }
    expect(s.stacks).toBe(3);
    expect(s.next_tick_at).toBe(3000); // never pushed forward by repeated procs
    expect(s.expires_at).toBe(16000);
  });

  it('expires against a reference time', () => {
    expect(isEffectExpired({ expires_at: 500 }, 500)).toBe(true);
    expect(isEffectExpired({ expires_at: 501 }, 500)).toBe(false);
  });
});

describe('cast event generation', () => {
  const base = {
    creatureId: 'c1', creatureName: 'Vanguard', characterId: 'p1', characterName: 'Calikon',
    label: 'Cataclysm', emoji: '☄️', damage: 42,
  };

  it('uses the default sentence with the damage-type adjective', () => {
    const m = buildCastHitMessages({ ...base, damageType: 'fire' });
    expect(m.message).toBe("☄️ Vanguard's searing Cataclysm strikes Calikon! [42]");
    expect(m.selfMessage).toBe("☄️ Vanguard's searing Cataclysm strikes you! [42]");
  });

  it('collapses cleanly when the cast is untyped', () => {
    expect(buildCastHitMessages(base).message).toBe("☄️ Vanguard's Cataclysm strikes Calikon! [42]");
  });

  it('prefers authored flavor and skips the duplicate damage suffix', () => {
    expect(buildCastHitMessages({ ...base, hitFlavor: '{creature} crushes {target}' }).message)
      .toBe('☄️ Vanguard crushes Calikon [42]');
    expect(buildCastHitMessages({ ...base, hitFlavor: '{creature} crushes {target} for {damage}' }).message)
      .toBe('☄️ Vanguard crushes Calikon for 42');
  });

  it('emits a structured boss_cast_hit event with self/remote split', () => {
    const e = buildCastHitEvent({ ...base, damageType: 'frost' });
    expect(e.type).toBe('boss_cast_hit');
    expect(e.damage).toBe(42);
    expect(e.log_event.damageType).toBe('frost');
    expect(e.log_event.effectType).toBe('Cataclysm');
    expect(e.log_event.message).toContain('strikes you');
    expect(e.log_event.remoteMessage).toContain('strikes Calikon');
    expect(e.log_event.target).toEqual({ kind: 'player', id: 'p1', name: 'Calikon' });
  });
});
