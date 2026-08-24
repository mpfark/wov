/**
 * The real admin load/save transformation — the functions the creature editor
 * actually calls, not a synthetic canonical-builder call.
 *
 * The published editor set the checkbox from `!!boss_cast` and wrote
 * `boss_cast: null` when it was off, so an explicitly disabled boss or an opt-in
 * rare showed as enabled and an unrelated creature edit could silently activate
 * or erase a configured cast. These tests pin the corrected behaviour.
 */
import { describe, expect, it } from 'vitest';
import { bossCastFormFromCreature, buildBossCastSave } from '@/components/admin/boss-cast-form';
import {
  deriveCastIdentities,
  normalizeBossCast,
} from '@/shared/combat/c3/boss-cast-contract';

const TICK = 2000;
const CID = 'df33b7d1-44db-48a4-a80b-2d86657cc6ce';

/** A production-shaped legacy row: no ability_key, legacy vocabulary, extras. */
const storedCast = (over: Record<string, unknown> = {}) => ({
  label: 'Choking Roots',
  amount: 55,
  base_amount: 55,
  base_aoe_amount: 0,
  cast_ms: 4000,
  cooldown_ms: 26000,
  lock_ms: 4000,
  chance: 0.24,
  damage_type: 'nature',
  cast_flavor: '{creature} drags the roots upward.',
  hit_flavor: '{creature} crushes {target} for [{amount}].',
  stored_power: { cap: 128, consume_mode: 'all', primary_share: 0.55, aoe_share: 0.45 },
  accumulate: {
    enabled: true,
    method: 'expected',
    source: 'primary_target',
    pause_autoattacks: true,
    crit_during_cast: 'disabled',
  },
  house_note: 'tuned by hand',
  ...over,
});

const save = (rarity: string, form: ReturnType<typeof bossCastFormFromCreature>, creatureId = CID) =>
  buildBossCastSave(form, { rarity, creatureId, level: 35, tickRateMs: TICK });

describe('admin boss cast — enabled state round-trips through runtime eligibility', () => {
  it('boss with a cast loads as enabled unless explicitly disabled', () => {
    expect(
      bossCastFormFromCreature({ rarity: 'boss', boss_cast: storedCast() }, TICK).boss_cast_enabled,
    ).toBe(true);
    expect(
      bossCastFormFromCreature({ rarity: 'boss', boss_cast: storedCast({ enabled: false }) }, TICK)
        .boss_cast_enabled,
    ).toBe(false);
  });

  it('rare with a cast loads as enabled only when opted in', () => {
    expect(
      bossCastFormFromCreature({ rarity: 'rare', boss_cast: storedCast() }, TICK).boss_cast_enabled,
    ).toBe(false);
    expect(
      bossCastFormFromCreature({ rarity: 'rare', boss_cast: storedCast({ enabled: true }) }, TICK)
        .boss_cast_enabled,
    ).toBe(true);
  });

  it('regular, unknown rarity and no cast all load as off', () => {
    expect(
      bossCastFormFromCreature({ rarity: 'regular', boss_cast: storedCast() }, TICK)
        .boss_cast_enabled,
    ).toBe(false);
    expect(
      bossCastFormFromCreature({ rarity: null, boss_cast: storedCast() }, TICK).boss_cast_enabled,
    ).toBe(false);
    expect(
      bossCastFormFromCreature({ rarity: 'boss', boss_cast: null }, TICK).boss_cast_enabled,
    ).toBe(false);
  });
});

describe('admin boss cast — unchecking preserves, never deletes', () => {
  it('existing cast + checkbox off keeps the whole configuration, disabled', () => {
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: storedCast() }, TICK);
    const out = save('boss', { ...form, boss_cast_enabled: false });
    expect(out.preservedDisabled).toBe(true);
    expect(out.payload).not.toBeNull();
    const p = out.payload!;
    expect(p.enabled).toBe(false);
    expect(p.label).toBe('Choking Roots');
    expect(p.base_amount).toBe(55);
    expect(p.cooldown_ms).toBe(26000);
    expect(p.chance).toBe(0.24);
    expect(p.damage_type).toBe('nature');
    expect(p.cast_flavor).toBe(storedCast().cast_flavor);
    expect(p.house_note).toBe('tuned by hand');
    expect(p.stored_power).toMatchObject({ cap: 128, primary_share: 0.55, aoe_share: 0.45 });
    expect(p.accumulate).toMatchObject({ source: 'primary_target', crit_during_cast: 'disabled' });
    // Disabled means it cannot schedule.
    expect(normalizeBossCast(p, { rarity: 'boss', creatureId: CID, level: 35, tickRateMs: TICK }))
      .toBeNull();
  });

  it('an already-disabled boss survives an unrelated creature edit untouched', () => {
    const stored = storedCast({ enabled: false, ability_key: 'choking_roots__df33b7d1' });
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: stored }, TICK);
    expect(form.boss_cast_enabled).toBe(false);
    const out = save('boss', form);
    expect(out.payload!.enabled).toBe(false);
    expect(out.payload!.ability_key).toBe('choking_roots__df33b7d1');
    expect(out.payload!.house_note).toBe('tuned by hand');
    expect(out.problems).toEqual([]);
  });

  it('a rare missing `enabled` becomes explicitly disabled, losing nothing', () => {
    const form = bossCastFormFromCreature({ rarity: 'rare', boss_cast: storedCast() }, TICK);
    const out = save('rare', form);
    expect(out.payload!.enabled).toBe(false);
    expect(out.payload!.base_amount).toBe(55);
    expect(out.payload!.house_note).toBe('tuned by hand');
  });

  it('changing rarity neither enables nor deletes an existing cast', () => {
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: storedCast() }, TICK);
    const asRegular = save('regular', form);
    expect(asRegular.payload).not.toBeNull();
    expect(asRegular.payload!.enabled).toBe(false);
    expect(asRegular.payload!.base_amount).toBe(55);
  });

  it('a new creature with nothing configured writes null', () => {
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: null }, TICK);
    expect(save('boss', form).payload).toBeNull();
  });

  it('a disabled incomplete legacy row is preserved without validation errors', () => {
    const form = bossCastFormFromCreature(
      { rarity: 'boss', boss_cast: { label: 'Half Authored', enabled: false } },
      TICK,
    );
    const out = save('boss', form);
    expect(out.problems).toEqual([]);
    expect(out.payload!.enabled).toBe(false);
  });
});

describe('admin boss cast — identity', () => {
  it('an enabled legacy row gains exactly the migration-derived key', () => {
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: storedCast() }, TICK);
    const out = save('boss', form);
    const [migration] = deriveCastIdentities([
      { creatureId: CID, label: 'Choking Roots', abilityKey: null },
    ]);
    expect(out.payload!.ability_key).toBe(migration.key);
    const runtime = normalizeBossCast(out.payload!, {
      rarity: 'boss',
      creatureId: CID,
      level: 35,
      tickRateMs: TICK,
    });
    expect(runtime!.abilityKey).toBe(migration.key);
  });

  it('two new creatures sharing a cast label get stable, distinct, non-placeholder keys', () => {
    const idA = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const blank = bossCastFormFromCreature({ rarity: 'boss', boss_cast: null }, TICK);
    const form = { ...blank, boss_cast_enabled: true, boss_cast_label: 'Cataclysm', boss_cast_base_amount: 40 };
    const a = save('boss', form, idA).payload!.ability_key as string;
    const b = save('boss', form, idB).payload!.ability_key as string;
    expect(a).not.toBe(b);
    expect(a).toBe(save('boss', form, idA).payload!.ability_key);
    for (const key of [a, b]) {
      expect(key).not.toContain('new');
      expect(key.length).toBeGreaterThan('cataclysm__'.length);
    }
  });

  it('renaming the label after backfill does not move identity', () => {
    const stored = storedCast({ ability_key: 'choking_roots__df33b7d1' });
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: stored }, TICK);
    const out = save('boss', { ...form, boss_cast_label: 'Strangling Vines' });
    expect(out.payload!.ability_key).toBe('choking_roots__df33b7d1');
    expect(out.payload!.label).toBe('Strangling Vines');
  });
});

describe('admin boss cast — save is idempotent', () => {
  it('a second load/save produces no further change', () => {
    const form = bossCastFormFromCreature({ rarity: 'boss', boss_cast: storedCast() }, TICK);
    const first = save('boss', form).payload!;
    const reloaded = bossCastFormFromCreature({ rarity: 'boss', boss_cast: first }, TICK);
    const second = save('boss', reloaded).payload!;
    expect(second).toEqual(first);
    const rctx = { rarity: 'boss' as const, creatureId: CID, level: 35, tickRateMs: TICK };
    expect(normalizeBossCast(second, rctx)).toEqual(normalizeBossCast(first, rctx));
  });

  it('runtime contract parity before and after normalization', () => {
    const stored = storedCast();
    const rctx = { rarity: 'boss' as const, creatureId: CID, level: 35, tickRateMs: TICK };
    const before = normalizeBossCast(stored, rctx)!;
    const after = normalizeBossCast(
      save('boss', bossCastFormFromCreature({ rarity: 'boss', boss_cast: stored }, TICK)).payload!,
      rctx,
    )!;
    expect(after).toEqual(before);
  });
});
