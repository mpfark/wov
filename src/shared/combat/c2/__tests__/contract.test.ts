import { describe, it, expect } from 'vitest';
import {
  LOOT_FALLBACK_CHANCE,
  resolveEffectiveDropChance,
  resolveStoredPower,
} from '../contract';
import { encounterDeathId } from '../death-id';
import { md5Hex } from '../md5';
import { deriveCharacterDeaths } from '../deaths';
import type { ProposedTick } from '../../pure/types';

const POOL = { drop_chance_regular: 0.2, drop_chance_rare: 0.4, drop_chance_boss: 0.9 };

describe('md5 parity with Postgres md5(text)', () => {
  it('matches known digests', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
  });
});

describe('death occurrence ids', () => {
  const enc = '11111111-1111-1111-1111-111111111111';
  const creature = '22222222-2222-2222-2222-222222222222';

  it('is a uuid and is stable', () => {
    const a = encounterDeathId(enc, creature, 1, 10);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(encounterDeathId(enc, creature, 1, 10)).toBe(a);
  });

  it('differs after respawn (same creature, later spawn generation)', () => {
    expect(encounterDeathId(enc, creature, 1, 10)).not.toBe(encounterDeathId(enc, creature, 2, 10));
  });

  it('differs per tick', () => {
    expect(encounterDeathId(enc, creature, 1, 10)).not.toBe(encounterDeathId(enc, creature, 1, 11));
  });
});

describe('loot chance precedence', () => {
  it('authored creature override wins', () => {
    expect(resolveEffectiveDropChance({ rarity: 'boss', dropChance: 0.05 }, POOL)).toEqual({
      chance: 0.05,
      source: 'creature',
    });
  });

  it('pool configuration default per rarity', () => {
    expect(resolveEffectiveDropChance({ rarity: 'regular', dropChance: null }, POOL).chance).toBe(0.2);
    expect(resolveEffectiveDropChance({ rarity: 'rare', dropChance: null }, POOL).chance).toBe(0.4);
    expect(resolveEffectiveDropChance({ rarity: 'boss', dropChance: null }, POOL).source).toBe(
      'pool_config',
    );
  });

  it('falls back to the explicit legacy chance when configuration is missing', () => {
    expect(resolveEffectiveDropChance({ rarity: 'rare', dropChance: null }, null)).toEqual({
      chance: LOOT_FALLBACK_CHANCE,
      source: 'legacy_fallback',
    });
    expect(LOOT_FALLBACK_CHANCE).toBe(0.5);
  });

  it('an authored zero is honoured, not treated as missing', () => {
    expect(resolveEffectiveDropChance({ rarity: 'regular', dropChance: 0 }, POOL)).toEqual({
      chance: 0,
      source: 'creature',
    });
  });
});

describe('stored power precedence', () => {
  const base = {
    creatureId: 'c1',
    current: 3,
    activeCastCap: null as number | null,
    creatureConfiguredCap: null as number | null,
    encounterDefaultCap: null as number | null,
  };

  it('active cast override wins', () => {
    expect(
      resolveStoredPower({ ...base, activeCastCap: 5, creatureConfiguredCap: 8, encounterDefaultCap: 9 }),
    ).toMatchObject({ cap: 5, capSource: 'active_cast', active: true });
  });

  it('then casting creature configuration', () => {
    expect(resolveStoredPower({ ...base, creatureConfiguredCap: 8, encounterDefaultCap: 9 })).toMatchObject(
      { cap: 8, capSource: 'casting_creature' },
    );
  });

  it('then the encounter default', () => {
    expect(resolveStoredPower({ ...base, encounterDefaultCap: 9 })).toMatchObject({
      cap: 9,
      capSource: 'encounter_default',
    });
  });

  it('otherwise inactive', () => {
    expect(resolveStoredPower(base)).toMatchObject({ cap: 0, capSource: 'inactive', active: false });
  });

  it('keeps per-creature identity rather than one global cap', () => {
    const a = resolveStoredPower({ ...base, creatureId: 'boss-a', activeCastCap: 4 });
    const b = resolveStoredPower({ ...base, creatureId: 'boss-b', creatureConfiguredCap: 12 });
    expect([a.creatureId, a.cap]).toEqual(['boss-a', 4]);
    expect([b.creatureId, b.cap]).toEqual(['boss-b', 12]);
  });
});

function tickWith(overrides: Partial<ProposedTick>): ProposedTick {
  return {
    encounterId: 'e1',
    tickNumber: 7,
    mode: 'live',
    ticksProcessed: 1,
    resolvedAtMs: 0,
    rngDraws: 0,
    characters: [],
    creatures: [],
    effectUpserts: [],
    effectDeleteIds: [],
    effectDeleteTargetIds: [],
    engagementsJoin: [],
    engagementsPurgeCreatureIds: [],
    casts: [],
    storedPower: [],
    durability: [],
    kills: [],
    rewards: [],
    loot: [],
    materials: [],
    gems: [],
    bonds: [],
    consumedActionIds: [],
    rejectedActions: [],
    session: { ended: false, lastTickAtMs: 0 },
    events: [],
    ...overrides,
  } as ProposedTick;
}

const dead = (id: string) => ({
  characterId: id,
  hpBefore: 5,
  hpAfter: 0,
  cpBefore: 0,
  cpAfter: 0,
  absorbShieldAfter: 0,
  died: true,
});

describe('character death derivation', () => {
  it('emits exactly one death per character even with several damage events', () => {
    const deaths = deriveCharacterDeaths(
      tickWith({
        characters: [dead('char-1')],
        events: [
          { seq: 1, type: 'creature_damage', message: '', characterId: 'char-1', creatureId: 'cr-1', amount: 3, damageType: 'physical' },
          { seq: 2, type: 'dot_damage', message: '', characterId: 'char-1', creatureId: 'cr-1', amount: 2, damageType: 'poison' },
        ],
      }),
    );
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({ characterId: 'char-1', sourceKind: 'dot', tickNumber: 7 });
  });

  it('attributes boss cast and stored power releases', () => {
    const deaths = deriveCharacterDeaths(
      tickWith({
        characters: [dead('char-2')],
        events: [
          { seq: 1, type: 'boss_cast_resolved', message: '', characterId: 'char-2', creatureId: 'boss', amount: 40, damageType: 'fire' },
        ],
      }),
    );
    expect(deaths[0]).toMatchObject({ sourceKind: 'boss_cast', sourceCreatureId: 'boss', amount: 40 });
  });

  it('reports unknown attribution rather than inventing a source', () => {
    const deaths = deriveCharacterDeaths(tickWith({ characters: [dead('char-3')] }));
    expect(deaths[0]).toMatchObject({ sourceKind: 'unknown', sourceCreatureId: null });
  });

  it('emits nothing for survivors, and is order-stable', () => {
    const deaths = deriveCharacterDeaths(
      tickWith({
        characters: [
          dead('b-char'),
          { ...dead('a-char') },
          { ...dead('c-char'), died: false, hpAfter: 4 },
        ],
      }),
    );
    expect(deaths.map((d) => d.characterId)).toEqual(['a-char', 'b-char']);
  });
});
