/**
 * Golden tests for the boss-cast contract.
 *
 * These lock the three things the outage proved were unprotected:
 *  1. every stored shape in production decodes to a live cast,
 *  2. eligibility follows rarity exactly as the pre-cutover handler did,
 *  3. an admin round-trip never loses a key or moves a value to a second home.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeBossCast,
  buildCanonicalBossCast,
  validateCanonicalBossCast,
  castEnabled,
  deriveCastIdentities,
  deriveCastFallbackKey,
  slugifyCastLabel,
  msToTicks,
  BossCastContractError,
  BOSS_CAST_DEFAULTS,
  type BossCastContext,
} from '@/shared/combat/c3/boss-cast-contract';

const ctx = (over: Partial<BossCastContext> = {}): BossCastContext => ({
  rarity: 'boss',
  creatureId: '11111111-2222-3333-4444-555555555555',
  level: 20,
  tickRateMs: 2000,
  ...over,
});

/** The exact shape every production row carries: legacy vocabulary, no ability_key. */
const legacyRow = {
  label: 'Ruinous Decree',
  cast_ms: 4000,
  cooldown_ms: 20000,
  base_amount: 40,
  base_aoe_amount: 18,
  cast_flavor: '{creature} raises a ruinous decree.',
  hit_flavor: '{creature} unleashes the decree for [{amount}].',
  damage_type: 'arcane',
  stored_power: { cap: 200, primary_share: 1, aoe_share: 0.4 },
  accumulate: { enabled: true, source: 'primary_target', method: 'expected' },
};

describe('boss cast — stored shapes decode', () => {
  it('decodes a legacy production row with no ability_key', () => {
    const cast = normalizeBossCast(legacyRow, ctx());
    expect(cast).not.toBeNull();
    // The fallback is creature-anchored — the exact key the backfill prepares.
    expect(cast!.abilityKey).toBe(
      deriveCastFallbackKey('Ruinous Decree', ctx().creatureId),
    );
    expect(cast!.abilityKey).toBe(
      deriveCastIdentities([
        { creatureId: ctx().creatureId, label: 'Ruinous Decree', abilityKey: null },
      ])[0].key,
    );
    expect(cast!.label).toBe('Ruinous Decree');
    // 4000ms / 2000ms tick rate.
    expect(cast!.castTicks).toBe(2);
    expect(cast!.cooldownTicks).toBe(10);
    expect(cast!.damage).toBe(40);
    expect(cast!.damageAoe).toBe(18);
    expect(cast!.damageType).toBe('arcane');
    expect(cast!.castingText).toBe(legacyRow.cast_flavor);
    expect(cast!.castedText).toBe(legacyRow.hit_flavor);
    expect(cast!.chance).toBe(BOSS_CAST_DEFAULTS.chance);
    expect(cast!.channeling).toBe(true);
    expect(cast!.pauseAutoattacks).toBe(true);
  });

  it('prefers canonical keys but falls back when they are empty', () => {
    const cast = normalizeBossCast(
      { ...legacyRow, ability_key: 'ruinous_decree_v2', casting_text: '   ' },
      ctx(),
    );
    expect(cast!.abilityKey).toBe('ruinous_decree_v2');
    // Blank canonical prose must not erase authored legacy prose.
    expect(cast!.castingText).toBe(legacyRow.cast_flavor);
  });

  it('never starts a cast at zero damage', () => {
    const cast = normalizeBossCast(
      { label: 'Silent Word', base_amount: 0 },
      ctx({ level: 30 }),
    );
    // Historical curve: 8 + floor(level * 1.5).
    expect(cast!.damage).toBe(8 + Math.floor(30 * 1.5));
  });

  it('applies default timing when none is authored', () => {
    const cast = normalizeBossCast({ label: 'Bare Row' }, ctx());
    expect(cast!.castTicks).toBe(BOSS_CAST_DEFAULTS.castMs / 2000);
    expect(cast!.cooldownTicks).toBe(BOSS_CAST_DEFAULTS.cooldownMs / 2000);
  });

  it('treats a missing damage_type as valid presentation-only absence', () => {
    const { damage_type: _omit, ...noType } = legacyRow;
    const cast = normalizeBossCast(noType, ctx());
    expect(cast).not.toBeNull();
    expect(cast!.damageType ?? null).toBeNull();
  });

  it('returns null for empty or absent rows', () => {
    expect(normalizeBossCast({}, ctx())).toBeNull();
    expect(normalizeBossCast(null, ctx())).toBeNull();
    expect(normalizeBossCast('nonsense', ctx())).toBeNull();
  });
});

describe('boss cast — eligibility follows rarity', () => {
  it('bosses telegraph unless explicitly disabled', () => {
    expect(castEnabled('boss', null)).toBe(true);
    expect(castEnabled('boss', true)).toBe(true);
    expect(castEnabled('boss', false)).toBe(false);
    expect(normalizeBossCast({ ...legacyRow, enabled: false }, ctx())).toBeNull();
  });

  it('rares are opt-in', () => {
    expect(castEnabled('rare', null)).toBe(false);
    expect(castEnabled('rare', true)).toBe(true);
    expect(normalizeBossCast(legacyRow, ctx({ rarity: 'rare' }))).toBeNull();
    expect(normalizeBossCast({ ...legacyRow, enabled: true }, ctx({ rarity: 'rare' }))).not.toBeNull();
  });

  it('regular creatures and unknown rarity never telegraph', () => {
    expect(normalizeBossCast({ ...legacyRow, enabled: true }, ctx({ rarity: 'regular' }))).toBeNull();
    expect(normalizeBossCast({ ...legacyRow, enabled: true }, ctx({ rarity: null }))).toBeNull();
  });
});

describe('boss cast — identity is stable and collision-safe', () => {
  it('keeps an already-stored key untouched', () => {
    const [id] = deriveCastIdentities([
      { creatureId: 'c1', label: 'Ruinous Decree', abilityKey: 'legacy_key' },
    ]);
    expect(id.key).toBe('legacy_key');
  });

  it('disambiguates identical labels on different creatures deterministically', () => {
    const rows = [
      { creatureId: 'aaaaaaaa-1111-1111-1111-111111111111', label: 'Cataclysm', abilityKey: null },
      { creatureId: 'bbbbbbbb-2222-2222-2222-222222222222', label: 'Cataclysm', abilityKey: null },
    ];
    const first = deriveCastIdentities(rows).map((r) => r.key);
    const again = deriveCastIdentities(rows).map((r) => r.key);
    expect(new Set(first).size).toBe(2);
    expect(again).toEqual(first);
  });

  it('the runtime decoder derives exactly the migration key, row by row', () => {
    const rows = [
      { creatureId: 'aaaaaaaa-1111-1111-1111-111111111111', label: "Headsman's Measure" },
      { creatureId: 'bbbbbbbb-2222-2222-2222-222222222222', label: 'Headsmans  MEASURE!' },
      { creatureId: 'cccccccc-3333-3333-3333-333333333333', label: 'Cataclysm' },
    ];
    const migration = deriveCastIdentities(rows.map((r) => ({ ...r, abilityKey: null })));
    rows.forEach((row, i) => {
      const cast = normalizeBossCast(
        { ...legacyRow, label: row.label },
        ctx({ creatureId: row.creatureId }),
      );
      expect(cast!.abilityKey).toBe(migration[i].key);
    });
    // Punctuation/case collisions stay unique because the anchor differs.
    expect(new Set(migration.map((m) => m.key)).size).toBe(3);
  });

  it('never rewrites an explicit key when the label changes', () => {
    const a = normalizeBossCast({ ...legacyRow, ability_key: 'pinned' }, ctx());
    const b = normalizeBossCast(
      { ...legacyRow, ability_key: 'pinned', label: 'Renamed Entirely' },
      ctx(),
    );
    expect(a!.abilityKey).toBe('pinned');
    expect(b!.abilityKey).toBe('pinned');
  });

  it('keeps cast_key as a compatibility fallback', () => {
    const cast = normalizeBossCast({ ...legacyRow, cast_key: 'legacy_cast_key' }, ctx());
    expect(cast!.abilityKey).toBe('legacy_cast_key');
  });
});

describe('boss cast — timing fails closed without an authoritative tick rate', () => {
  it('converts on the supplied grid, 2000 ms and otherwise', () => {
    expect(msToTicks(4000, 2000)).toBe(2);
    expect(msToTicks(4000, 1000)).toBe(4);
    expect(msToTicks(5000, 3000)).toBe(2);
    expect(msToTicks(100, 2000)).toBe(1);
    expect(normalizeBossCast(legacyRow, ctx({ tickRateMs: 1000 }))!.castTicks).toBe(4);
  });

  it('throws instead of silently assuming 2000 ms', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined as any]) {
      expect(() => msToTicks(4000, bad)).toThrow(BossCastContractError);
      expect(() => normalizeBossCast(legacyRow, ctx({ tickRateMs: bad }))).toThrow(
        BossCastContractError,
      );
    }
  });

  it('reports an invalid tick rate as an authoring problem', () => {
    const problems = validateCanonicalBossCast(
      { ability_key: 'k', label: 'L', cast_ms: 4000, cooldown_ms: 20000, chance: 0.3, base_amount: 10 },
      ctx({ tickRateMs: 0 }),
    );
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/tick rate/i);
  });
});

describe('boss cast — admin round-trip preserves data', () => {
  it('writes only the canonical vocabulary and keeps unknown keys', () => {
    const stored = { ...legacyRow, ability_key: 'ruinous_decree', house_note: 'do not touch' };
    const written = buildCanonicalBossCast(
      {
        abilityKey: 'ruinous_decree',
        enabled: true,
        label: 'Ruinous Decree',
        damageType: 'arcane',
        castFlavor: legacyRow.cast_flavor,
        hitFlavor: legacyRow.hit_flavor,
        baseAmount: 40,
        baseAoeAmount: 18,
        castMs: 4000,
        cooldownMs: 20000,
        chance: 0.3,
        lockMs: 0,
        targetMode: 'tank_preferred',
        storedPower: {
          consumeMode: 'all',
          consumePct: 100,
          consumeAmount: 0,
          primaryShare: 1,
          aoeShare: 0.4,
          cap: 200,
        },
        accumulate: {
          enabled: true,
          source: 'primary_target',
          method: 'expected',
          pauseAutoattacks: true,
          critDuringCast: 'disabled',
        },
      },
      stored,
    );

    expect(written.house_note).toBe('do not touch');
    // The legacy `amount` mirror is retired: no value gets two homes.
    expect(written.amount).toBeUndefined();
    expect(validateCanonicalBossCast(written, ctx())).toEqual([]);

    // The written row must decode back to the same runtime contract.
    const before = normalizeBossCast(stored, ctx());
    const after = normalizeBossCast(written, ctx());
    expect(after).toEqual(before);
  });

  it('rejects a row that would cast for nothing', () => {
    const bad = buildCanonicalBossCast(
      {
        abilityKey: '',
        enabled: true,
        label: '',
        damageType: null,
        castFlavor: null,
        hitFlavor: null,
        baseAmount: 0,
        baseAoeAmount: 0,
        castMs: 0,
        cooldownMs: 0,
        chance: 0,
        lockMs: 0,
        targetMode: 'tank_preferred',
        storedPower: {
          consumeMode: 'all',
          consumePct: 100,
          consumeAmount: 0,
          primaryShare: 1,
          aoeShare: 0.4,
          cap: null,
        },
        accumulate: {
          enabled: true,
          source: 'primary_target',
          method: 'expected',
          pauseAutoattacks: true,
          critDuringCast: 'disabled',
        },
      },
      undefined,
    );
    expect(validateCanonicalBossCast(bad, ctx()).length).toBeGreaterThan(0);
  });
});
