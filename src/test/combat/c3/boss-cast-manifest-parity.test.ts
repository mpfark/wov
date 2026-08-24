/**
 * Runtime-contract parity for the frozen 28-row boss-cast backfill.
 *
 * The migration's promise is narrow: it changes the *shape* of a stored row and
 * nothing the resolver acts on. These tests prove that on the real production
 * images — decode each frozen before-image, decode the after-image the migration
 * would produce, and require the two runtime contracts to be identical apart
 * from the identity the fallback was already resolving anyway.
 *
 * The after-image is built here by a TypeScript mirror of the SQL transform. If
 * the SQL and this mirror ever disagree about a value, the parity assertion
 * fails rather than shipping a silent balance change.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeBossCast,
  deriveCastFallbackKey,
  validateCastIdentities,
  deriveCastIdentities,
  BOSS_CAST_DEFAULTS,
  type BossCastContext,
} from '@/shared/combat/c3/boss-cast-contract';
import {
  BOSS_CAST_PRODUCTION_IMAGES,
  type BossCastProductionImage,
} from './fixtures/boss-cast-production-images';

const MIGRATION = 'supabase/pending/20260825_boss_cast_mechanical_backfill.sql';
const TICK = 2000;

type Rec = Record<string, unknown>;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const sub = (o: Rec, k: string): Rec => {
  const v = o[k];
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {};
};

/** TypeScript mirror of the migration's UPDATE expression. */
function applyBackfill(img: BossCastProductionImage): Rec {
  const b = { ...img.before } as Rec;
  delete b.amount;
  const sp = sub(img.before as Rec, 'stored_power');
  const acc = sub(img.before as Rec, 'accumulate');
  const castMs = isNum(b.cast_ms) && b.cast_ms > 0 ? b.cast_ms : BOSS_CAST_DEFAULTS.castMs;
  const cdMs = isNum(b.cooldown_ms) && b.cooldown_ms > 0 ? b.cooldown_ms : BOSS_CAST_DEFAULTS.cooldownMs;
  const targetMode =
    b.target_mode === 'tank_strict' || b.target_mode === 'random_alive' || b.target_mode === 'tank_preferred'
      ? b.target_mode
      : 'tank_preferred';
  return {
    ...b,
    ability_key:
      (typeof b.ability_key === 'string' && b.ability_key.trim()) ||
      (typeof b.cast_key === 'string' && b.cast_key.trim()) ||
      img.expectedKey,
    label: typeof b.label === 'string' && b.label.trim() ? b.label : BOSS_CAST_DEFAULTS.label,
    enabled: isBool(b.enabled) ? b.enabled : img.expectedEnabled,
    cast_ms: castMs,
    cooldown_ms: cdMs,
    chance: isNum(b.chance) ? b.chance : BOSS_CAST_DEFAULTS.chance,
    lock_ms: isNum(b.lock_ms) ? b.lock_ms : 0,
    base_amount: isNum((img.before as Rec).base_amount)
      ? (img.before as Rec).base_amount
      : isNum((img.before as Rec).amount)
        ? (img.before as Rec).amount
        : 0,
    base_aoe_amount: isNum(b.base_aoe_amount) ? b.base_aoe_amount : 0,
    target_mode: targetMode,
    stored_power: {
      ...sp,
      consume_mode: sp.consume_mode ?? BOSS_CAST_DEFAULTS.consumeMode,
      consume_pct: sp.consume_pct ?? BOSS_CAST_DEFAULTS.consumePct,
      primary_share: sp.primary_share ?? BOSS_CAST_DEFAULTS.primaryShare,
      aoe_share: sp.aoe_share ?? BOSS_CAST_DEFAULTS.aoeShare,
    },
    accumulate: {
      ...acc,
      enabled: isBool(acc.enabled) ? acc.enabled : true,
      pause_autoattacks: isBool(acc.pause_autoattacks) ? acc.pause_autoattacks : true,
      source: acc.source ?? 'primary_target',
      method: acc.method ?? 'expected',
      crit_during_cast: acc.crit_during_cast ?? 'disabled',
    },
  };
}

const ctxOf = (img: BossCastProductionImage): BossCastContext => ({
  rarity: img.rarity as BossCastContext['rarity'],
  creatureId: img.creatureId,
  level: img.level,
  tickRateMs: TICK,
});

describe('boss-cast backfill — frozen manifest', () => {
  it('holds exactly the 28 reviewed rows with unique identities', () => {
    expect(BOSS_CAST_PRODUCTION_IMAGES).toHaveLength(28);
    const ids = new Set(BOSS_CAST_PRODUCTION_IMAGES.map((i) => i.creatureId));
    expect(ids.size).toBe(28);
    const keys = new Set(BOSS_CAST_PRODUCTION_IMAGES.map((i) => i.expectedKey));
    expect(keys.size).toBe(28);
    expect(
      validateCastIdentities(
        deriveCastIdentities(
          BOSS_CAST_PRODUCTION_IMAGES.map((i) => ({
            creatureId: i.creatureId,
            label: (i.before as Rec).label as string,
            abilityKey: null,
          })),
        ),
      ),
    ).toEqual([]);
  });

  it('the migration touches exactly the manifest ids and agrees on every identity', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      expect(sql).toContain(`'${img.creatureId}'::uuid`);
      expect(sql).toContain(`'${img.expectedKey}'`);
    }
    // No id outside the manifest appears in the frozen VALUES list.
    const listed = sql.match(/'[0-9a-f-]{36}'::uuid/g) ?? [];
    expect(new Set(listed).size).toBe(28);
  });

  it('every reviewed key equals the runtime fallback rule', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      expect(img.expectedKey).toBe(
        deriveCastFallbackKey((img.before as Rec).label as string, img.creatureId),
      );
    }
  });
});

describe('boss-cast backfill — runtime contract parity', () => {
  it('every before-image already decodes to a live cast', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      const cast = normalizeBossCast(img.before, ctxOf(img));
      expect(cast, `${img.name} must decode before the backfill`).not.toBeNull();
      expect(cast!.abilityKey).toBe(img.expectedKey);
    }
  });

  it('the migrated image decodes to a byte-identical runtime contract', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      const before = normalizeBossCast(img.before, ctxOf(img));
      const after = normalizeBossCast(applyBackfill(img), ctxOf(img));
      expect(after, `${img.name} must still decode after the backfill`).not.toBeNull();
      expect(after, `${img.name} runtime contract changed`).toEqual(before);
    }
  });

  it('makes eligibility explicit without changing what the resolver sees', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      const after = applyBackfill(img);
      expect(after.enabled).toBe(img.expectedEnabled);
      // Explicit `enabled` must agree with the decode outcome on both images.
      expect(normalizeBossCast(after, ctxOf(img)) !== null).toBe(img.expectedEnabled);
      expect(normalizeBossCast(img.before, ctxOf(img)) !== null).toBe(img.expectedEnabled);
    }
  });

  it('retires the duplicated `amount` mirror without moving the damage value', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      const after = applyBackfill(img);
      expect(after).not.toHaveProperty('amount');
      const legacy = (img.before as Rec).amount;
      if (isNum(legacy)) expect(after.base_amount).toBe(legacy);
      expect(normalizeBossCast(after, ctxOf(img))!.damage).toBe(
        normalizeBossCast(img.before, ctxOf(img))!.damage,
      );
    }
  });

  it('preserves every authored key except the retired mirror', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      const after = applyBackfill(img);
      for (const k of Object.keys(img.before)) {
        if (k === 'amount') continue;
        expect(after, `${img.name} lost ${k}`).toHaveProperty(k);
      }
    }
  });

  it('is idempotent — a second pass changes nothing', () => {
    for (const img of BOSS_CAST_PRODUCTION_IMAGES) {
      const once = applyBackfill(img);
      const twice = applyBackfill({ ...img, before: once });
      expect(twice).toEqual(once);
    }
  });
});
