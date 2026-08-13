import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadSnapshotAux, snapshotAbilityConfigVersion } from '@/shared/combat/c3/loader';

/**
 * The loader must derive every configuration value from the pinned snapshot.
 * If it could read the database, ability magnitudes, XP, weapon progression or
 * tank selection would not be covered by the commit's configVersion check.
 */
const SOURCE = readFileSync('src/shared/combat/c3/loader.ts', 'utf8');

const baseRoot = {
  participants: [{ id: 'c1', partyId: 'p1', classKey: 'warrior', level: 5, attrs: {} }],
  actions: [],
  creatures: [],
  config: {
    abilityConfigVersion: 'v-abc',
    xpBoostMultiplier: 2,
    weaponProgression: { tier1_level: 1, tier2_level: 11, tier3_level: 21 },
    tanks: [{ partyId: 'p1', tankCharacterId: 'c1' }],
  },
};

const catalog = { configVersion: 'v-abc', lookup: () => null };

describe('c3 loader configuration pinning', () => {
  it('performs no database access', () => {
    expect(SOURCE).not.toMatch(/\.from\(/);
    expect(SOURCE).not.toMatch(/\.rpc\(/);
    expect(loadSnapshotAux.length).toBe(1);
  });

  it('takes xp boost, weapon progression and tanks from the snapshot config', () => {
    const { aux } = loadSnapshotAux({
      snapshotRoot: baseRoot,
      mode: 'live',
      nowMs: 1_000,
      ticksToSimulate: 1,
      catalog,
    });
    expect(aux.xpBoostMultiplier).toBe(2);
    expect(aux.weaponProgression.tier2_level).toBe(11);
    expect(aux.tankByPartyId.get('p1')).toBe('c1');
  });

  it('refuses a snapshot without a configuration block', () => {
    expect(() =>
      loadSnapshotAux({
        snapshotRoot: { participants: [], actions: [], creatures: [] },
        mode: 'live',
        nowMs: 1,
        ticksToSimulate: 1,
        catalog,
      }),
    ).toThrow(/configuration block/);
  });

  it('exposes the pinned ability configuration version', () => {
    expect(snapshotAbilityConfigVersion(baseRoot)).toBe('v-abc');
    expect(() => snapshotAbilityConfigVersion({ config: {} })).toThrow(/abilityConfigVersion/);
  });
});
