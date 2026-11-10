import { describe, expect, it } from 'vitest';
import inventory from '../../combat/inventory/active-abilities.json';
import { prepareTick, step, type AuthoredAbilityRecord, type AppliedStatusRow } from '../engine';
import { buildAbilityCatalog } from '../catalog';
import { adaptClaimedBossCatalog } from '../boss-catalog';
import { resolveNodeTick } from '../resolver';
import { CLAIM } from './roundtrip-contract.test';

const authored = inventory as { abilities: AuthoredAbilityRecord[]; statuses: AppliedStatusRow[] };
function state() {
  const snapshot = structuredClone(CLAIM.snapshot);
  snapshot.boss_configurations = snapshot.creatures.map(creature => ({
    encounter_id: snapshot.encounter.id, node_creature_id: creature.id,
    creature_id: creature.creature_id, spawn_seq: creature.spawn_seq, boss_cast: null,
  }));
  return snapshot;
}

describe('engine-owned authored preparation', () => {
  it('preserves the complete proposal from the previous catalog and resolver path', () => {
    const snapshot = state();
    const before = structuredClone(snapshot);
    const prepared = prepareTick(snapshot, authored.abilities, authored.statuses);
    expect(prepared.ok).toBe(true);
    if (prepared.ok === false) throw new Error(prepared.kind);
    const oldAbilities = buildAbilityCatalog(authored.abilities, authored.statuses);
    const oldBosses = adaptClaimedBossCatalog(snapshot);
    expect(step(prepared.state, prepared.deps)).toEqual(
      resolveNodeTick(oldBosses.snapshot, { abilities: oldAbilities.specs }));
    expect(snapshot).toEqual(before);
  });
  it('keeps a missing required status as a catalog refusal, never a silent default', () => {
    const out = prepareTick(state(), authored.abilities, authored.statuses.filter(row => row.key !== 'ignite'));
    expect(out.ok).toBe(false);
    expect(out).toMatchObject({ kind: 'player_catalog_rejected' });
  });
  it('keeps missing boss configuration as a boss catalog refusal', () => {
    const snapshot = state();
    snapshot.boss_configurations = [];
    expect(prepareTick(snapshot, authored.abilities, authored.statuses)).toMatchObject({
      ok: false, kind: 'boss_catalog_rejected',
    });
  });
});
