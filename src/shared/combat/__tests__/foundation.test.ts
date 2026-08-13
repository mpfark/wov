import { describe, it, expect } from 'vitest';
import { absorbFromShield, resolveDamage, resolveHeal } from '../resolution';

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

describe('absorbFromShield (ward soak, mid-pipeline)', () => {
  it('soaks up to the pool and passes the rest onward', () => {
    expect(absorbFromShield(10, 4)).toEqual({ absorbed: 4, remaining: 6, shieldAfter: 0 });
  });

  it('fully absorbs when the pool is deep enough', () => {
    expect(absorbFromShield(7, 20)).toEqual({ absorbed: 7, remaining: 0, shieldAfter: 13 });
  });

  it('is a no-op without a ward and clamps junk input', () => {
    expect(absorbFromShield(5, 0)).toEqual({ absorbed: 0, remaining: 5, shieldAfter: 0 });
    expect(absorbFromShield(-3, NaN)).toEqual({ absorbed: 0, remaining: 0, shieldAfter: 0 });
  });

  it('matches the old inline expression it replaced', () => {
    for (const [dmg, pool] of [[13, 5], [2, 9], [0, 3], [40, 40]]) {
      const absorbed = Math.min(dmg, pool);
      const w = absorbFromShield(dmg, pool);
      expect(w.absorbed).toBe(absorbed);
      expect(w.remaining).toBe(dmg - absorbed);
      expect(w.shieldAfter).toBe(pool - absorbed);
    }
  });
});
