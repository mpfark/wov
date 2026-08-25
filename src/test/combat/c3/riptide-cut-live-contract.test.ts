/**
 * Riptide Cut — pinned live production image.
 *
 * Ser Caldris' stored `boss_cast` was read read-only from production and frozen
 * below verbatim. The deployed functions previously decoded this exact row as
 * `baseDamage: 0`, `cooldown: 0`, roughly one tick of cast time and
 * `pauseAutoattacks: false`, which is why the cast restarted every tick and
 * falsely reported that it "landed on empty ground".
 *
 * This test pins the decoded contract so that regression can never ship again.
 * It asserts the numbers a human can check against the authored row, not the
 * normalizer's own output re-derived from itself.
 */
import { describe, expect, it } from 'vitest';
import { normalizeBossCast, type BossCastContext } from '@/shared/combat/c3/boss-cast-contract';

/** Frozen production image, captured read-only. Do not "tidy" this object. */
const SER_CALDRIS_BOSS_CAST = {
  ability_key: 'riptide_cut__3fc61566',
  label: 'Riptide Cut',
  base_amount: 55,
  base_aoe_amount: 0,
  cast_ms: 4000,
  cooldown_ms: 24000,
  lock_ms: 4000,
  chance: 0.25,
  damage_type: 'physical',
  enabled: true,
  target_mode: 'tank_preferred',
  cast_flavor: '%a shifts with unnatural grace...',
  hit_flavor: "%a's blade slips through guard and armor alike in a single, fluid motion.",
  accumulate: {
    enabled: true,
    method: 'expected',
    source: 'primary_target',
    pause_autoattacks: true,
    crit_during_cast: 'disabled',
  },
  stored_power: {
    cap: 112,
    primary_share: 0.65,
    aoe_share: 0.55,
    consume_mode: 'all',
    consume_pct: 100,
    consume_amount: 0,
  },
} as const;

const CTX: BossCastContext = {
  rarity: 'boss',
  creatureId: '3fc61566-798a-4a6c-8020-4db41dcb3b0a',
  level: 30,
  tickRateMs: 2000,
};

describe('Riptide Cut live contract', () => {
  const cast = normalizeBossCast(SER_CALDRIS_BOSS_CAST, CTX);

  it('decodes to a cast at all (the pre-fix decoder returned null/zeroes)', () => {
    expect(cast).not.toBeNull();
  });

  it('carries the authored identity and flavor', () => {
    expect(cast!.abilityKey).toBe('riptide_cut__3fc61566');
    expect(cast!.label).toBe('Riptide Cut');
    expect(cast!.castingText).toBe('%a shifts with unnatural grace...');
    expect(cast!.castedText).toBe(
      "%a's blade slips through guard and armor alike in a single, fluid motion.",
    );
  });

  it('carries the authored damage', () => {
    expect(cast!.damage).toBe(55);
    expect(cast!.damageAoe).toBe(0);
    expect(cast!.damageType).toBe('physical');
  });

  it('derives cast/cooldown from ms at the authoritative tick rate', () => {
    // 4000 ms telegraph at 2000 ms/tick = 2 ticks: it can never resolve on the
    // tick it starts.
    expect(cast!.castTicks).toBe(2);
    expect(cast!.castTicks).toBeGreaterThan(0);
    // 24000 ms / 2000 = 12 ticks, not zero (the stale decode made it every tick).
    expect(cast!.cooldownTicks).toBe(12);
  });

  it('keeps the chance gate and autoattack pause', () => {
    expect(cast!.chance).toBe(0.25);
    expect(cast!.pauseAutoattacks).toBe(true);
    expect(cast!.channeling).toBe(true);
    expect(cast!.lockMs).toBe(4000);
  });

  it('keeps the Stored Power contract', () => {
    expect(cast!.storedPowerCap).toBe(112);
    expect(cast!.primaryShare).toBe(0.65);
    expect(cast!.aoeShare).toBe(0.55);
    expect(cast!.consumeMode).toBe('all');
  });

  it('is target-mode tank_preferred', () => {
    expect(cast!.targetMode).toBe('tank_preferred');
  });
});
