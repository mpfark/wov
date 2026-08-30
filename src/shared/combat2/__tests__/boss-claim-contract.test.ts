import { describe, expect, it } from 'vitest';
import { adaptClaimedBossCatalog, TICK_MS } from '../boss-catalog';
import { decodeClaim } from '../decode';
import { CLAIM } from './roundtrip-contract.test';

function claimedBoss(overrides: Record<string, unknown> = {}) {
  const claim = structuredClone(CLAIM) as any;
  const creature = claim.snapshot.creatures[0];
  claim.snapshot.boss_configurations = [{
    encounter_id: claim.encounter_id,
    node_creature_id: creature.id,
    creature_id: creature.creature_id,
    spawn_seq: creature.spawn_seq,
    boss_cast: {
      enabled: true,
      ability_key: 'tidal_crash',
      label: 'Tidal Crash',
      cast_ms: TICK_MS + 1,
      chance: 0.5,
      base_amount: 17,
      target_mode: 'tank',
      ...overrides,
    },
  }];
  return claim;
}

describe('claimed authored boss configuration', () => {
  it('accepts a normal creature with no cast and fabricates no ability', () => {
    const claim = claimedBoss();
    claim.snapshot.boss_configurations[0].boss_cast = null;
    const decoded = decodeClaim(claim);
    if (decoded.ok !== true) throw new Error(decoded.errors.join('; '));
    expect(adaptClaimedBossCatalog(decoded.snapshot)).toMatchObject({
      snapshot: { boss_abilities: [] },
      rejected: [],
    });
  });

  it('preserves the encounter/spawn binding and uses the existing windup adapter', () => {
    const decoded = decodeClaim(claimedBoss());
    if (decoded.ok !== true) throw new Error(decoded.errors.join('; '));
    const out = adaptClaimedBossCatalog(decoded.snapshot);
    expect(out.rejected).toEqual([]);
    expect(decoded.snapshot.boss_configurations?.[0]).toMatchObject({ spawn_seq: 7 });
    expect(out.snapshot.boss_abilities[0]).toMatchObject({
      ability_key: 'tidal_crash', creature_id: CLAIM.snapshot.creatures[0].creature_id,
      windup_ticks: 2, magnitude: 17, spawn_seq: 7,
    });
  });

  it('fails closed for foreign encounter, creature, node-creature, or old-spawn binding', () => {
    for (const field of ['encounter_id', 'creature_id', 'node_creature_id', 'spawn_seq']) {
      const claim = claimedBoss();
      claim.snapshot.boss_configurations[0][field] = field === 'spawn_seq' ? 6 : 'foreign-id';
      const decoded = decodeClaim(claim);
      expect(decoded.ok, field).toBe(false);
    }
  });

  it('rejects malformed and explicitly unsupported authored configurations', () => {
    const malformed = claimedBoss({ cast_ms: 'slow' });
    expect(decodeClaim(malformed).ok).toBe(false);
    const decoded = decodeClaim(claimedBoss({ stored_power: { amount: 5 } }));
    if (decoded.ok !== true) throw new Error(decoded.errors.join('; '));
    expect(adaptClaimedBossCatalog(decoded.snapshot).rejected[0].reason).toBe('stored_power_unsupported');
  });

  it('keeps an already captured snapshot deterministic when a later source value changes', () => {
    const first = claimedBoss({ base_amount: 17 });
    const captured = decodeClaim(first);
    if (captured.ok !== true) throw new Error(captured.errors.join('; '));
    first.snapshot.boss_configurations[0].boss_cast.base_amount = 99;
    const later = decodeClaim(first);
    if (later.ok !== true) throw new Error(later.errors.join('; '));
    expect(adaptClaimedBossCatalog(captured.snapshot).snapshot.boss_abilities[0].magnitude).toBe(17);
    expect(adaptClaimedBossCatalog(later.snapshot).snapshot.boss_abilities[0].magnitude).toBe(99);
  });
});
