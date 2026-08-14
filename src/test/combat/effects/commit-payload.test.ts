/**
 * Guard: the C2 commit payload must carry the FULL semantic effect row.
 *
 * A rewrite that omits `mechanic`, `magnitude`, `remaining`, `params`,
 * `paramsVersion`, `damageType` or the ability key erases an effect's identity
 * at the database boundary — absorb pools and one-shot charges vanish, and the
 * deployed `validate_active_effect` trigger refuses the whole commit with
 * "immutable field may not change", failing the entire tick. This test fails if
 * any contract field is dropped from the serialised upsert again.
 */
import { describe, expect, it } from 'vitest';
import { buildCommitPayload } from '@/shared/combat/c2/payload';
import { SNAPSHOT_VERSION, type SnapshotEnvelope } from '@/shared/combat/c2/contract';
import { EFFECT_PARAMS_VERSION } from '@/shared/combat/pure/effect-contract';
import type { EffectUpsert, ProposedTick } from '@/shared/combat/pure/types';

const envelope = {
  snapshotVersion: SNAPSHOT_VERSION,
  encounterId: 'enc-1',
  nodeId: 'node-1',
  tickNumber: 7,
  encounterVersion: 3,
  loadedAtMs: 1000,
  claim: { tick: 7, token: 'tok', resolverId: 'res', mode: 'live' },
  cursor: { tickNumber: 6, tickAtMs: 1000 },
  scope: { characterIds: ['char-1'], creatureIds: ['creature-1'] },
  stateDigest: {},
  spawnSeqByCreatureId: { 'creature-1': 1 },
  durabilityByInventoryId: {},
  dropChanceByCreatureId: {},
  storedPower: [],
  lootFallbackChance: 0,
} as unknown as SnapshotEnvelope;

const upsert: EffectUpsert = {
  targetKind: 'character',
  targetId: 'char-1',
  effectType: 'force_shield',
  stacks: 1,
  amountPerTick: 0,
  expiresAtMs: 60_000,
  intervalMs: 2000,
  nextTickAtMs: 4000,
  damageType: 'arcane',
  sourceCharacterId: 'char-1',
  mechanic: 'absorb_buff',
  abilityKey: 'force_shield_v2',
  magnitude: 60,
  remaining: 42,
  params: {},
  paramsVersion: EFFECT_PARAMS_VERSION,
};

// Only the effect section matters here; every other collection reads as empty,
// so the fixture cannot rot when an unrelated proposal section is added.
const emptyProposed = new Proxy(
  { effectUpserts: [upsert], rngDraws: 0 } as Record<string, unknown>,
  { get: (t, k) => (k in t ? t[k as string] : []) },
) as unknown as ProposedTick;

describe('C2 commit payload effect serialisation', () => {
  const payload = buildCommitPayload(envelope, emptyProposed, {
    sessionId: null, ended: false, engagedCreatureIds: [],
  }) as unknown as { effectUpserts: Record<string, unknown>[] };
  const row = payload.effectUpserts[0];

  it('carries every semantic field of the effect row', () => {
    expect(row).toMatchObject({
      targetId: 'char-1',
      sourceId: 'char-1',
      effectType: 'force_shield',
      stacks: 1,
      amountPerTick: 0,
      expiresAtMs: 60_000,
      intervalMs: 2000,
      nextTickAtMs: 4000,
      mechanic: 'absorb_buff',
      magnitude: 60,
      remaining: 42,
      damageType: 'arcane',
      paramsVersion: EFFECT_PARAMS_VERSION,
    });
    expect(row.params).toEqual({});
  });

  it('preserves the ability key instead of substituting the effect type', () => {
    expect(row.sourceAbilityKey).toBe('force_shield_v2');
  });

  it('leaves no contract field undefined', () => {
    for (const key of [
      'mechanic', 'magnitude', 'remaining', 'params', 'paramsVersion', 'damageType', 'sourceAbilityKey',
    ]) {
      expect(row[key], key).not.toBeUndefined();
    }
  });
});
