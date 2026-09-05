import { describe, expect, it, vi } from 'vitest';
import inventory from '../../../shared/combat/inventory/active-abilities.json';
import type { AuthoredAbilityRecord } from '../../../shared/combat2/catalog';
import { CLAIM } from '../../../shared/combat2/__tests__/roundtrip-contract.test';
import { processNodeTickOnce, type NodeTickTransport } from '../process-node-tick-once';

const NODE = CLAIM.snapshot.encounter.node_id;
const abilities = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;

function successfulClaim() {
  const claim = structuredClone(CLAIM) as any;
  claim.snapshot.boss_configurations = claim.snapshot.creatures.map((creature: any) => ({
    encounter_id: claim.encounter_id,
    node_creature_id: creature.id,
    creature_id: creature.creature_id,
    spawn_seq: creature.spawn_seq,
    boss_cast: null,
  }));
  claim.snapshot.pending_events = [{
    id: 'aaaa0000-0000-4000-8000-000000000008', event_type: 'entered',
    actor_character_id: CLAIM.snapshot.fighters[0].character_id, actor_creature_id: null,
    target_character_id: null, target_creature_id: null, payload: {},
    occurred_at: CLAIM.snapshot.encounter.now,
  }];
  return claim;
}

function transport(claim: unknown, commit: unknown = { ok: true, kind: 'committed', tick: 1 }) {
  const calls: { nodeIds: string[]; commits: any[] } = { nodeIds: [], commits: [] };
  const value: NodeTickTransport = {
    async claimNode(nodeId) { calls.nodeIds.push(nodeId); return claim; },
    async commitTick(args) { calls.commits.push(args); return commit; },
  };
  return { value, calls };
}

describe('processNodeTickOnce', () => {
  it.each([
    [{ ok: false, kind: 'not_due', next_due_at: '2026-08-30T00:00:00Z' }, 'not_due'],
    [{ ok: false, kind: 'no_claim', reason: 'in_flight' }, 'in_flight'],
    [{ ok: false, kind: 'no_claim', reason: 'locked_or_absent' }, 'locked_or_absent'],
  ] as const)('returns for refused claim %# without resolution or commit', async (claim, kind) => {
    const t = transport(claim);
    const resolve = vi.fn();
    const out = await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: abilities, resolve });
    expect(out.kind).toBe(kind);
    expect(resolve).not.toHaveBeenCalled();
    expect(t.calls.commits).toHaveLength(0);
  });

  it('fails closed on malformed claim', async () => {
    const t = transport({ ok: true, kind: 'claimed' });
    const resolve = vi.fn();
    expect((await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: abilities, resolve })).ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(t.calls.commits).toHaveLength(0);
  });

  it('preserves node, claim authority, proposal intent and pending-event IDs', async () => {
    const claim = successfulClaim();
    const t = transport(claim);
    const resolve = vi.fn((snapshot: any) => ({
      tick: snapshot.encounter.candidate_tick, characters: [], creatures: [], effects_insert: [],
      effects_update: [], effects_delete: [], fighters: [], rewards: [], events: [],
      departures: [],
      intent_ids: [claim.snapshot.intents[0].id], participation: [],
      pending_event_ids: [claim.snapshot.pending_events[0].id],
    }));
    const out = await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: abilities, resolve });
    expect(out.kind).toBe('committed');
    expect(t.calls.nodeIds).toEqual([NODE]);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(t.calls.commits).toHaveLength(1);
    expect(t.calls.commits[0]).toMatchObject({
      _encounter_id: claim.encounter_id, _claim_token: claim.claim_token,
      _candidate_tick: claim.candidate_tick, _expected_last_tick: claim.last_committed_tick,
      _expected_state_version: claim.state_version, _intent_ids: [claim.snapshot.intents[0].id],
      _proposed: { pending_event_ids: [claim.snapshot.pending_events[0].id] },
    });
  });

  it('rejects player and boss catalogue gaps without commit', async () => {
    const badAbility = [{ ...abilities[0], mechanic: 'invented_mechanic' }];
    let t = transport(successfulClaim());
    expect((await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: badAbility })).kind)
      .toBe('player_catalog_rejected');
    expect(t.calls.commits).toHaveLength(0);

    const claim = successfulClaim();
    claim.snapshot.boss_configurations[0].boss_cast = {
      enabled: true, ability_key: 'bad', cast_ms: 2000, base_amount: 10,
      stored_power: { amount: 1 },
    };
    t = transport(claim);
    expect((await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: abilities })).kind)
      .toBe('boss_catalog_rejected');
    expect(t.calls.commits).toHaveLength(0);
  });

  it('contains resolver exceptions and does not commit', async () => {
    const t = transport(successfulClaim());
    const out = await processNodeTickOnce(NODE, {
      transport: t.value, abilityRecords: abilities, resolve: () => { throw new Error('safe failure'); },
    });
    expect(out).toMatchObject({ ok: false, kind: 'resolver_failed', diagnostic: 'safe failure' });
    expect(t.calls.commits).toHaveLength(0);
  });

  it.each([
    [{ ok: false, kind: 'stale_claim' }, 'stale_claim'],
    [{ ok: false, kind: 'stale_claim', reason: 'no_encounter' }, 'stale_claim'],
    [{ ok: false, kind: 'stale_snapshot' }, 'stale_snapshot'],
    [{ ok: false, kind: 'foreign_reference', relation: 'intents' }, 'foreign_reference'],
    [{ ok: true, kind: 'already_committed', tick: 1 }, 'already_committed'],
  ] as const)('classifies commit %# without retry', async (commit, kind) => {
    const t = transport(successfulClaim(), commit);
    const resolve = vi.fn(() => ({ tick: 1, characters: [], creatures: [], effects_insert: [],
      effects_update: [], effects_delete: [], fighters: [], rewards: [], events: [], intent_ids: [],
      participation: [], pending_event_ids: [], departures: [] }));
    expect((await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: abilities, resolve })).kind).toBe(kind);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(t.calls.commits).toHaveLength(1);
  });

  it('produces an identical proposal for an identical captured claim', async () => {
    const a = transport(successfulClaim());
    const b = transport(successfulClaim());
    await processNodeTickOnce(NODE, { transport: a.value, abilityRecords: abilities });
    await processNodeTickOnce(NODE, { transport: b.value, abilityRecords: abilities });
    expect(JSON.stringify(a.calls.commits[0]._proposed)).toBe(JSON.stringify(b.calls.commits[0]._proposed));
  });

  it('commits first autoattack state with its owner and exact creature target in one proposal', async () => {
    const claim = successfulClaim();
    claim.snapshot.intents = [];
    claim.snapshot.pending_events = [];
    claim.snapshot.creatures[0].hp = 100;
    claim.snapshot.creatures[0].max_hp = 100;
    const t = transport(claim);

    const out = await processNodeTickOnce(NODE, { transport: t.value, abilityRecords: abilities });

    expect(out.kind).toBe('committed');
    expect(t.calls.commits).toHaveLength(1);
    expect(t.calls.commits[0]._proposed.effects_insert).toContainEqual(expect.objectContaining({
      kind: 'autoattack',
      target_character_id: claim.snapshot.fighters[0].character_id,
      target_creature_id: claim.snapshot.creatures[0].creature_id,
    }));
    expect(t.calls.commits[0]._proposed.events).toContainEqual(expect.objectContaining({
      kind: 'attack',
      actor: expect.objectContaining({ id: claim.snapshot.fighters[0].character_id }),
      target: expect.objectContaining({ id: claim.snapshot.creatures[0].creature_id }),
      meta: expect.objectContaining({ basicAttack: true }),
    }));
  });

  it('reports a safe commit stage and PostgreSQL code without retrying, then permits a later reclaim', async () => {
    const failed = transport(successfulClaim());
    failed.value.commitTick = async (args) => {
      failed.calls.commits.push(args);
      throw Object.assign(new Error('constraint detail must not escape'), { code: '23514', detail: 'private row' });
    };
    const first = await processNodeTickOnce(NODE, { transport: failed.value, abilityRecords: abilities });
    expect(first).toEqual({
      ok: false, kind: 'commit_transport_error', diagnostic: 'transport failed safely', stage: 'commit', code: '23514',
    });
    expect(failed.calls.commits).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain('constraint detail');
    expect(JSON.stringify(first)).not.toContain('private row');

    const reclaimed = transport(successfulClaim());
    const second = await processNodeTickOnce(NODE, { transport: reclaimed.value, abilityRecords: abilities });
    expect(second.kind).toBe('committed');
    expect(reclaimed.calls.nodeIds).toEqual([NODE]);
    expect(reclaimed.calls.commits).toHaveLength(1);
  });
});
