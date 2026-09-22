/**
 * Regression coverage for the authoritative commit request.
 *
 * Reproduces a real automatic tick with no newly submitted ability intent and an otherwise
 * equivalent tick carrying an accepted ability intent, driving both through the production
 * resolve path and the production serialization boundary rather than a mocked "commit succeeds".
 * All identifiers are synthetic fixture values.
 */
import { describe, expect, it, vi } from 'vitest';
import inventory from '../../../shared/combat/inventory/active-abilities.json';
import type { AuthoredAbilityInventory, AuthoredAbilityRecord } from '../../../shared/combat2/catalog';
import { CLAIM } from '../../../shared/combat2/__tests__/roundtrip-contract.test';
import { PROPOSAL_FIELDS, processNodeTickOnce, type CommitTickArgs, type NodeTickTransport } from '../process-node-tick-once';

const NODE = CLAIM.snapshot.encounter.node_id;
const abilityRecords = (inventory as { abilities: AuthoredAbilityRecord[] }).abilities;
const statusRecords = (inventory as AuthoredAbilityInventory).statuses;

function claimFor(mode: 'no_intent' | 'with_intent') {
  const claim = structuredClone(CLAIM) as any;
  claim.snapshot.boss_configurations = claim.snapshot.creatures.map((creature: any) => ({
    encounter_id: claim.encounter_id, node_creature_id: creature.id, creature_id: creature.creature_id,
    spawn_seq: creature.spawn_seq, boss_cast: null,
  }));
  if (mode === 'no_intent') claim.snapshot.intents = [];
  return claim;
}

/** Mirrors the deployed adapter: JSON body encoding, then a structured commit envelope. */
function transport(claim: unknown, onCommit?: (args: CommitTickArgs) => unknown) {
  const commits: CommitTickArgs[] = [];
  const bodies: string[] = [];
  const value: NodeTickTransport = {
    async claimNode() { return claim; },
    async commitTick(args) {
      commits.push(args);
      bodies.push(JSON.stringify(args));
      return onCommit ? onCommit(args) : { ok: true, kind: 'committed', tick: args._candidate_tick };
    },
  };
  return { value, commits, bodies };
}

async function run(mode: 'no_intent' | 'with_intent', onCommit?: (args: CommitTickArgs) => unknown) {
  const t = transport(claimFor(mode), onCommit);
  const result = await processNodeTickOnce(NODE, { transport: t.value, abilityRecords, statusRecords });
  return { result, ...t };
}

describe('commit request contract', () => {
  it.each(['no_intent', 'with_intent'] as const)('forms a complete, serializable commit request (%s)', async (mode) => {
    const { result, commits, bodies } = await run(mode);

    expect(result.kind).toBe('committed');
    expect(commits).toHaveLength(1);
    const proposed = commits[0]._proposed as unknown as Record<string, unknown>;
    for (const field of PROPOSAL_FIELDS) {
      if (field === 'status') continue;
      expect(proposed[field], `${field} must be present, never omitted`).toBeDefined();
    }
    // Serialization must be lossless: no key may disappear through the RPC body encoding.
    const decoded = JSON.parse(bodies[0])._proposed as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(Object.keys(proposed).sort());
    expect(commits[0]._expected_last_tick).toBe(CLAIM.snapshot.encounter.tick);
    expect(commits[0]._expected_state_version).toBe(CLAIM.snapshot.encounter.state_version);
  });

  it('represents an empty intent collection as an explicit empty array', async () => {
    const { commits, bodies } = await run('no_intent');
    expect(commits[0]._intent_ids).toEqual([]);
    expect(JSON.parse(bodies[0])._intent_ids).toEqual([]);
    expect(commits[0]._proposed.intent_ids).toEqual([]);
  });

  it('commits automatic creature and autoattack resolution without any player input', async () => {
    const { result, commits } = await run('no_intent');
    expect(result.kind).toBe('committed');
    expect(commits[0]._proposed.intent_ids).toHaveLength(0);
    expect(commits[0]._proposed.events.length).toBeGreaterThan(0);
  });

  it('still commits normally when an ability intent was accepted', async () => {
    const { result, commits } = await run('with_intent');
    expect(result.kind).toBe('committed');
    expect(commits[0]._proposed.intent_ids).toHaveLength(1);
  });

  it('differs from an ability tick only in intent-derived collections', async () => {
    const none = await run('no_intent');
    const some = await run('with_intent');
    const shape = (args: CommitTickArgs) => Object.fromEntries(
      Object.entries(args._proposed as unknown as Record<string, unknown>)
        .map(([key, value]) => [key, Array.isArray(value) ? value.length : typeof value]),
    );
    const a = shape(none.commits[0]);
    const b = shape(some.commits[0]);
    const differing = Object.keys(a).filter((key) => a[key] !== b[key]).sort();
    expect(differing).toEqual(['characters', 'intent_ids']);
  });

  it('carries no undefined, NaN or BigInt value anywhere in the request', async () => {
    const { commits } = await run('no_intent');
    const hazards: string[] = [];
    (function walk(value: unknown, path: string) {
      if (value === undefined) hazards.push(`${path}=undefined`);
      else if (typeof value === 'number' && !Number.isFinite(value)) hazards.push(`${path}=${value}`);
      else if (typeof value === 'bigint') hazards.push(`${path}=bigint`);
      else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`);
      }
    })(commits[0], 'commit');
    expect(hazards).toEqual([]);
  });
});

describe('refused commit safety', () => {
  it('classifies an RPC refusal safely and never reports a committed tick', async () => {
    const { result, commits } = await run('no_intent', () => {
      throw Object.assign(new Error('database transport failed'),
        { code: '22P02', category: 'pg', field: 'intent_ids' });
    });
    expect(result).toEqual({
      ok: false, kind: 'commit_transport_error', diagnostic: 'transport failed safely',
      stage: 'commit', category: 'pg', code: '22P02', field: 'intent_ids', proposalIntents: 0,
    });
    expect(commits).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('database transport failed');
  });

  it('reports only closed-set field names and known categories', async () => {
    const { result } = await run('no_intent', () => {
      throw Object.assign(new Error('x'), { code: 'not-a-code', category: 'invented', field: 'player_email' });
    });
    expect(result).toMatchObject({ kind: 'commit_transport_error', category: 'unknown' });
    expect(result).not.toHaveProperty('field');
    expect(result).not.toHaveProperty('code');
  });

  it('records a network refusal with no database code as a fetch failure', async () => {
    const { result } = await run('no_intent', () => { throw new Error('network'); });
    expect(result).toMatchObject({ kind: 'commit_transport_error', category: 'fetch', proposalIntents: 0 });
  });

  it('fails closed before sending when the proposal cannot be serialized', async () => {
    const resolve = vi.fn((snapshot: any) => {
      const proposal = { tick: snapshot.encounter.candidate_tick, characters: [], creatures: [], effects_insert: [],
        effects_update: [], effects_delete: [], fighters: [], departures: [], rewards: [], loot: [], durability: [],
        equipment_fence: [], events: [], intent_ids: [], participation: [], pending_event_ids: [], boss_cooldowns: [] };
      (proposal as Record<string, unknown>).self = proposal;
      return proposal as never;
    });
    const t = transport(claimFor('no_intent'));
    const result = await processNodeTickOnce(NODE, { transport: t.value, abilityRecords, statusRecords, resolve });
    expect(result).toMatchObject({ ok: false, kind: 'commit_transport_error', category: 'serde' });
    expect(t.commits).toHaveLength(0);
  });

  it('retries the same tick without committing twice or duplicating gameplay effects', async () => {
    const attempts: CommitTickArgs[] = [];
    let first = true;
    const onCommit = (args: CommitTickArgs) => {
      attempts.push(args);
      if (first) { first = false; throw Object.assign(new Error('database transport failed'), { code: '22P02' }); }
      return { ok: true, kind: 'committed', tick: args._candidate_tick };
    };
    const failed = await run('no_intent', onCommit);
    expect(failed.result.ok).toBe(false);
    const retried = await run('no_intent', onCommit);
    expect(retried.result).toMatchObject({ ok: true, kind: 'committed', tick: CLAIM.snapshot.encounter.candidate_tick });

    // Both attempts fence on the same expected tick and state version, so at most one can commit.
    expect(attempts).toHaveLength(2);
    expect(attempts[0]._candidate_tick).toBe(attempts[1]._candidate_tick);
    expect(attempts[0]._expected_last_tick).toBe(attempts[1]._expected_last_tick);
    expect(attempts[0]._expected_state_version).toBe(attempts[1]._expected_state_version);
    expect(JSON.stringify(attempts[0]._proposed)).toBe(JSON.stringify(attempts[1]._proposed));
  });

  it('treats an already-committed retry as committed exactly once', async () => {
    const { result, commits } = await run('no_intent', (args) => ({ ok: true, kind: 'already_committed', tick: args._candidate_tick }));
    expect(result).toMatchObject({ ok: true, kind: 'already_committed' });
    expect(commits).toHaveLength(1);
  });

  it('keeps the claim, decode and reward-channel snapshot contracts unchanged', async () => {
    const claim = claimFor('no_intent');
    const creature = claim.snapshot.creatures[0];
    for (const field of ['gold_enabled', 'gold_min', 'gold_max', 'gold_chance', 'salvage_enabled', 'item_source']) {
      expect(creature[field], `${field} must remain part of the accepted claim snapshot`).toBeDefined();
    }
    expect((await run('no_intent')).result.kind).toBe('committed');
  });
});
