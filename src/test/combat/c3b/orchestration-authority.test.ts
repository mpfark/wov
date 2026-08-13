/**
 * C3b — orchestration authority matrix (fake database, no IO).
 *
 * Proves the properties the handler validation matrix asks for that are
 * decidable without a database:
 *   - live and catch-up can never resolve overlapping state (disjoint claim
 *     modes, single claim, catch-up creates no encounter)
 *   - every displayed result comes from a committed batch (no events on any
 *     failure path)
 *   - the claim is never leaked on a failure
 *   - the snapshot, not the caller, decides mode, roster and configuration
 */

import { describe, it, expect } from 'vitest';
import { orchestrateCombatResolution } from '@/shared/combat/c3/orchestration';

const NODE = '00000000-0000-4000-8000-000000000001';
const ENC = '00000000-0000-4000-8000-0000000000e1';
const CHAR = '00000000-0000-4000-8000-0000000000c1';
const CREATURE = '00000000-0000-4000-8000-0000000000f1';

interface Call { fn: string; args: Record<string, unknown> }

function snapshotRoot(overrides: Record<string, unknown> = {}) {
  return {
    loaded: true,
    snapshotVersion: 3,
    encounterId: ENC,
    encounterVersion: 4,
    nodeId: NODE,
    tickNumber: 7,
    tickRateMs: 2000,
    nowMs: 1_000_000,
    cursor: { tickAtMs: 1_000_000 - 2000 },
    scope: { participantIds: [CHAR], creatureIds: [CREATURE], partyIds: [], nodeIds: [NODE] },
    stateDigest: { d: 'x' },
    participants: [{
      id: CHAR, partyId: null, classKey: 'warrior', level: 5,
      hp: 20, maxHp: 20, cp: 100, maxCp: 100, mp: 10, maxMp: 10,
      attrs: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    }],
    creatures: [{
      id: CREATURE, spawnSeq: 1, name: 'Grub', level: 2, hp: 10, maxHp: 10, ac: 10,
      isAlive: true, rarity: 'regular',
    }],
    actions: [],
    effects: [],
    engagements: [],
    config: {
      abilityConfigVersion: 'v-test',
      xpBoostMultiplier: 1,
      weaponProgression: { tier1_level: 1, tier2_level: 11, tier3_level: 21 },
      tanks: [],
    },
    ...overrides,
  };
}

interface FakeOptions {
  mode?: string;
  claim?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  commit?: Record<string, unknown>;
  commitError?: { message: string };
}

function fakeDb(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          calls.push({ fn: `from:${table}`, args: {} });
          if (table === 'combat_config') return { data: { value: opts.mode ?? 'open' }, error: null };
          if (table === 'characters') return { data: { current_node_id: NODE }, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      switch (fn) {
        case 'encounter_intake':
          return { data: { ok: true, encounter_id: ENC }, error: null };
        case 'encounter_for_node':
          return { data: ENC, error: null };
        case 'claim_encounter_tick':
          return {
            data: opts.claim ?? {
              claimed: true, tick: 7, claim_token: 'tok', resolver_id: 'res',
              mode: (args._supported_modes as string[])[0],
            },
            error: null,
          };
        case 'encounter_snapshot_v2':
          return { data: opts.snapshot ?? snapshotRoot(), error: null };
        case 'commit_encounter_tick_v2':
          return { data: opts.commit ?? { committed: true }, error: opts.commitError ?? null };
        case 'release_encounter_tick':
          return { data: { released: true }, error: null };
        default:
          return { data: null, error: null };
      }
    },
  };
  return { db, calls };
}

const deps = (db: any, extra: Record<string, unknown> = {}) => ({
  db,
  nowMs: 1_000_000,
  catalog: { configVersion: 'v-test', lookup: () => null },
  newBatchId: () => 'batch-1',
  caller: 'test',
  ...extra,
});

describe('C3b — live vs catch-up exclusivity', () => {
  it('live asks only for a live claim; catch-up only for effects_only', async () => {
    const live = fakeDb();
    await orchestrateCombatResolution({ role: 'live', characterId: CHAR, creatureIds: [CREATURE] }, deps(live.db) as any);
    const catchup = fakeDb();
    await orchestrateCombatResolution({ role: 'catchup', nodeId: NODE }, deps(catchup.db) as any);

    const modes = (calls: Call[]) =>
      calls.find(c => c.fn === 'claim_encounter_tick')!.args._supported_modes as string[];
    expect(modes(live.calls)).toEqual(['live']);
    expect(modes(catchup.calls)).toEqual(['effects_only']);
    // Disjoint sets: neither role can ever take the other's tick.
    expect(modes(live.calls).some(m => modes(catchup.calls).includes(m))).toBe(false);
  });

  it('catch-up never creates an encounter and never runs intake', async () => {
    const { db, calls } = fakeDb();
    await orchestrateCombatResolution({ role: 'catchup', nodeId: NODE }, deps(db) as any);
    expect(calls.map(c => c.fn)).not.toContain('encounter_intake');
    expect(calls.map(c => c.fn)).toContain('encounter_for_node');
  });

  it('a refused claim resolves nothing and returns no events', async () => {
    const { db, calls } = fakeDb({ claim: { claimed: false, reason: 'resolving' } });
    const r = await orchestrateCombatResolution({ role: 'catchup', nodeId: NODE }, deps(db) as any);
    expect(r.ok).toBe(false);
    expect((r as any).kind).toBe('claim_refused');
    expect(calls.map(c => c.fn)).not.toContain('encounter_snapshot_v2');
    expect(calls.map(c => c.fn)).not.toContain('commit_encounter_tick_v2');
    expect((r as any).events).toBeUndefined();
  });

  it('takes its mode from the claim, never from the caller', async () => {
    // A live handler that the database hands an effects_only claim resolves in
    // catch-up mode; the request role only gates which modes are acceptable.
    const { db } = fakeDb({
      claim: { claimed: true, tick: 7, claim_token: 'tok', resolver_id: 'r', mode: 'effects_only' },
    });
    const r = await orchestrateCombatResolution(
      { role: 'live', characterId: CHAR, creatureIds: [CREATURE] }, deps(db) as any,
    );
    expect(r.ok).toBe(true);
    expect((r as any).mode).toBe('catchup');
  });
});

describe('C3b — only committed batches are displayed', () => {
  it('a successful tick reports the committed batch id', async () => {
    const { db, calls } = fakeDb();
    const r = await orchestrateCombatResolution(
      { role: 'live', characterId: CHAR, creatureIds: [CREATURE] }, deps(db) as any,
    );
    expect(r.ok).toBe(true);
    expect((r as any).batchId).toBe('batch-1');
    const commit = calls.find(c => c.fn === 'commit_encounter_tick_v2')!;
    expect(commit.args._batch_id).toBe('batch-1');
    expect(commit.args._tick).toBe(7);
    expect(commit.args._claim_token).toBe('tok');
  });

  it('a refused commit yields a failure with no events and releases the claim', async () => {
    const { db, calls } = fakeDb({ commit: { committed: false, reason: 'state_conflict' } });
    const r = await orchestrateCombatResolution(
      { role: 'live', characterId: CHAR, creatureIds: [CREATURE] }, deps(db) as any,
    );
    expect(r.ok).toBe(false);
    expect((r as any).kind).toBe('commit_refused');
    expect((r as any).events).toBeUndefined();
    expect(calls.some(c => c.fn === 'release_encounter_tick')).toBe(true);
  });

  it('classifies a lost lease and still releases', async () => {
    const { db, calls } = fakeDb({ commit: { committed: false, reason: 'lease_expired' } });
    const r = await orchestrateCombatResolution({ role: 'catchup', nodeId: NODE }, deps(db) as any);
    expect((r as any).kind).toBe('lease_lost');
    expect(calls.some(c => c.fn === 'release_encounter_tick')).toBe(true);
  });

  it('fails closed on a configuration version mismatch, before any commit', async () => {
    const { db, calls } = fakeDb();
    const r = await orchestrateCombatResolution(
      { role: 'live', characterId: CHAR },
      deps(db, { catalog: { configVersion: 'v-stale', lookup: () => null } }) as any,
    );
    expect((r as any).kind).toBe('config_conflict');
    expect(calls.map(c => c.fn)).not.toContain('commit_encounter_tick_v2');
    expect(calls.some(c => c.fn === 'release_encounter_tick')).toBe(true);
  });

  it('refuses a snapshot the database did not load', async () => {
    const { db, calls } = fakeDb({ snapshot: { loaded: false, reason: 'lease_expired' } });
    const r = await orchestrateCombatResolution({ role: 'catchup', nodeId: NODE }, deps(db) as any);
    expect((r as any).kind).toBe('snapshot_refused');
    expect(calls.map(c => c.fn)).not.toContain('commit_encounter_tick_v2');
  });

  it('is closed while combat is in maintenance — no encounter work at all', async () => {
    const { db, calls } = fakeDb({ mode: 'maintenance' });
    const r = await orchestrateCombatResolution(
      { role: 'live', characterId: CHAR, creatureIds: [CREATURE] }, deps(db) as any,
    );
    expect((r as any).kind).toBe('maintenance');
    expect(calls.filter(c => c.fn !== 'from:combat_config')).toEqual([]);
  });
});

describe('C3b — one encounter per node, shared by every caller', () => {
  it('routes two different characters at one node to the same encounter', async () => {
    const a = fakeDb();
    const b = fakeDb();
    const ra = await orchestrateCombatResolution({ role: 'live', characterId: CHAR }, deps(a.db) as any);
    const rb = await orchestrateCombatResolution(
      { role: 'live', characterId: '00000000-0000-4000-8000-0000000000c2' }, deps(b.db) as any,
    );
    expect((ra as any).encounterId).toBe(ENC);
    expect((rb as any).encounterId).toBe((ra as any).encounterId);
    // Both went through intake, which is the only place an encounter is created.
    expect(a.calls.some(c => c.fn === 'encounter_intake')).toBe(true);
    expect(b.calls.some(c => c.fn === 'encounter_intake')).toBe(true);
  });

  it('propagates an intake refusal as no_encounter without claiming', async () => {
    const calls: Call[] = [];
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: 'open' }, error: null }) }) }) }),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        if (fn === 'encounter_intake') return { data: { ok: false, reason: 'node_mismatch' }, error: null };
        return { data: null, error: null };
      },
    };
    const r = await orchestrateCombatResolution({ role: 'live', characterId: CHAR }, deps(db) as any);
    expect((r as any).kind).toBe('no_encounter');
    expect((r as any).reason).toBe('node_mismatch');
    expect(calls.map(c => c.fn)).not.toContain('claim_encounter_tick');
  });
});

describe('C3b — catch-up backlog is bounded and cursor-driven', () => {
  it('simulates one tick when live, and a bounded backlog when catching up', async () => {
    const live = fakeDb();
    const rl = await orchestrateCombatResolution(
      { role: 'live', characterId: CHAR, creatureIds: [CREATURE] }, deps(live.db) as any,
    );
    expect((rl as any).ticksProcessed).toBe(1);

    // 10 minutes of arrears at a 2s cadence must clamp to the 30-tick ceiling.
    const stale = fakeDb({
      claim: { claimed: true, tick: 7, claim_token: 'tok', resolver_id: 'r', mode: 'effects_only' },
      snapshot: snapshotRoot({ cursor: { tickAtMs: 1_000_000 - 600_000 } }),
    });
    const rc = await orchestrateCombatResolution({ role: 'catchup', nodeId: NODE }, deps(stale.db) as any);
    expect(rc.ok).toBe(true);
    expect((rc as any).ticksProcessed).toBeLessThanOrEqual(30);
    expect((rc as any).ticksProcessed).toBeGreaterThan(1);
  });
});
