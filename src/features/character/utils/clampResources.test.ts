import { describe, it, expect } from 'vitest';
import { clampResourceUpdates } from './clampResources';

const base = { max_hp: 233, max_cp: 100, max_mp: 80 };

describe('clampResourceUpdates', () => {
  // ─── Regen loop case (the snap-back bug) ────────────────────────
  it('keeps regen above base max when caps are supplied (no snap-back)', () => {
    const result = clampResourceUpdates(
      { hp: 250 },
      base,
      { maxHp: 250 },
    );
    expect(result.hp).toBe(250);
  });

  it('clamps to caller-supplied cap when value exceeds it', () => {
    const result = clampResourceUpdates(
      { hp: 999 },
      base,
      { maxHp: 250 },
    );
    expect(result.hp).toBe(250);
  });

  // ─── Legacy fallback (no effectiveCaps) ─────────────────────────
  it('clamps to base max_hp when no caps are supplied', () => {
    const result = clampResourceUpdates({ hp: 250 }, base);
    expect(result.hp).toBe(233);
  });

  it('clamps cp and mp to base maxes when no caps are supplied', () => {
    const result = clampResourceUpdates({ cp: 200, mp: 200 }, base);
    expect(result.cp).toBe(100);
    expect(result.mp).toBe(80);
  });

  // ─── Per-resource independence ──────────────────────────────────
  it('clamps cp and mp to their own effective caps independently', () => {
    const result = clampResourceUpdates(
      { hp: 250, cp: 130, mp: 95 },
      base,
      { maxHp: 250, maxCp: 130, maxMp: 95 },
    );
    expect(result.hp).toBe(250);
    expect(result.cp).toBe(130);
    expect(result.mp).toBe(95);
  });

  it('only overrides the specific cap supplied; other fields fall back to base', () => {
    const result = clampResourceUpdates(
      { hp: 250, cp: 200, mp: 200 },
      base,
      { maxHp: 250 }, // only HP cap given
    );
    expect(result.hp).toBe(250);   // uses gear cap
    expect(result.cp).toBe(100);   // falls back to base
    expect(result.mp).toBe(80);    // falls back to base
  });

  // ─── Untouched fields ───────────────────────────────────────────
  it('leaves hp/cp/mp untouched when not present in updates', () => {
    const result = clampResourceUpdates(
      { gold: 500, xp: 1234 },
      base,
      { maxHp: 250 },
    );
    expect(result).toEqual({ gold: 500, xp: 1234 });
    expect('hp' in result).toBe(false);
  });

  it('passes non-resource fields through unchanged', () => {
    const result = clampResourceUpdates(
      { hp: 250, gold: 500, xp: 1234, name: 'Cithrawiel' as any },
      base,
      { maxHp: 250 },
    );
    expect(result.gold).toBe(500);
    expect(result.xp).toBe(1234);
    expect((result as any).name).toBe('Cithrawiel');
  });

  // ─── Edge cases ─────────────────────────────────────────────────
  it('does not clamp values that are already below the cap', () => {
    const result = clampResourceUpdates(
      { hp: 100 },
      base,
      { maxHp: 250 },
    );
    expect(result.hp).toBe(100);
  });

  it('treats hp = 0 as a clampable value (death write must persist)', () => {
    const result = clampResourceUpdates(
      { hp: 0 },
      base,
      { maxHp: 250 },
    );
    expect(result.hp).toBe(0);
  });

  it('does not mutate the input updates object', () => {
    const updates = { hp: 999 };
    clampResourceUpdates(updates, base, { maxHp: 250 });
    expect(updates.hp).toBe(999);
  });
});
