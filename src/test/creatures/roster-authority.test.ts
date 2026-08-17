/**
 * Roster authority regressions.
 *
 * The reducer in useCreatures is the single roster owner. These tests pin the
 * contract the amended correction plan requires:
 *   - only an authoritative RPC response for the exact node can enable Attack
 *   - movement never carries a previous node's roster over
 *   - a same-node failure never wipes a valid roster
 *   - stale (node/request mismatch) responses are discarded entirely
 *   - realm_awake / respawn_pending never suppress living creatures
 *   - a stale spawn_seq cannot erase a newer respawn generation
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { rosterReducer, initialRoster } from '@/features/creatures';
import type { RosterState, Creature } from '@/features/creatures';

const NODE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NODE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function creature(id: string, over: Partial<Creature> = {}): Creature {
  return {
    id,
    name: `c-${id}`,
    description: '',
    node_id: NODE_A,
    rarity: 'regular',
    level: 1,
    hp: 10,
    max_hp: 10,
    stats: {},
    ac: 10,
    is_aggressive: false,
    loot_table: [],
    is_alive: true,
    respawn_seconds: 60,
    died_at: null,
    loot_table_id: null,
    drop_chance: 0,
    spawn_seq: 1,
    ...over,
  };
}

/** Load node A authoritatively with one living creature. */
function loaded(): RosterState {
  let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
  s = rosterReducer(s, {
    type: 'resolved',
    nodeId: NODE_A,
    requestId: 1,
    data: { node_id: NODE_A, realm_awake: true, respawn_pending: 0, creatures: [creature('c1')] },
  });
  return s;
}

const actionable = (s: RosterState) =>
  s.authoritative && (s.status === 'ready' || s.status === 'empty');

describe('roster reducer — authority', () => {
  it('is not actionable while loading', () => {
    const s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
    expect(s.status).toBe('loading');
    expect(actionable(s)).toBe(false);
  });

  it('cached seed data never becomes authoritative', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
    s = rosterReducer(s, { type: 'seed', nodeId: NODE_A, requestId: 1, creatures: [creature('c1')] });
    expect(s.creatures).toHaveLength(1);
    expect(s.authoritative).toBe(false);
    expect(actionable(s)).toBe(false);
  });

  it('becomes actionable only after a successful RPC for this node', () => {
    const s = loaded();
    expect(s.authoritative).toBe(true);
    expect(s.status).toBe('ready');
    expect(actionable(s)).toBe(true);
  });

  it('treats an authoritative empty roster as success, not error', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
    s = rosterReducer(s, {
      type: 'resolved', nodeId: NODE_A, requestId: 1,
      data: { node_id: NODE_A, realm_awake: true, respawn_pending: 0, creatures: [] },
    });
    expect(s.status).toBe('empty');
    expect(s.error).toBeNull();
    expect(actionable(s)).toBe(true);
  });

  it('keeps living creatures actionable while the realm is waking or respawns are pending', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
    s = rosterReducer(s, {
      type: 'resolved', nodeId: NODE_A, requestId: 1,
      data: { node_id: NODE_A, realm_awake: false, respawn_pending: 3, creatures: [creature('c1')] },
    });
    expect(s.creatures).toHaveLength(1);
    expect(s.realmAwake).toBe(false);
    expect(s.respawnPending).toBe(3);
    expect(actionable(s)).toBe(true);
  });
});

describe('roster reducer — failure behaviour', () => {
  it('same-node refresh failure keeps the valid roster and surfaces the error', () => {
    let s = loaded();
    s = rosterReducer(s, { type: 'failed', nodeId: NODE_A, requestId: 1, status: 'error', reason: 'boom' });
    expect(s.creatures).toHaveLength(1);
    expect(s.authoritative).toBe(true);
    expect(s.error).toBe('boom');
  });

  it('failure on a fresh node yields error with no actionable roster and no carry-over', () => {
    let s = loaded();
    s = rosterReducer(s, { type: 'begin', nodeId: NODE_B, requestId: 2 });
    expect(s.creatures).toHaveLength(0);
    expect(s.authoritative).toBe(false);
    s = rosterReducer(s, { type: 'failed', nodeId: NODE_B, requestId: 2, status: 'error', reason: 'net' });
    expect(s.status).toBe('error');
    expect(s.creatures).toHaveLength(0);
    expect(actionable(s)).toBe(false);
  });

  it('unauthorized is distinct from error and never actionable', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
    s = rosterReducer(s, { type: 'failed', nodeId: NODE_A, requestId: 1, status: 'unauthorized', reason: 'not_owned' });
    expect(s.status).toBe('unauthorized');
    expect(actionable(s)).toBe(false);
  });
});

describe('roster reducer — stale responses', () => {
  it('discards a response for a previous node', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_B, requestId: 2 });
    const before = s;
    s = rosterReducer(s, {
      type: 'resolved', nodeId: NODE_A, requestId: 1,
      data: { node_id: NODE_A, realm_awake: true, respawn_pending: 0, creatures: [creature('c1')] },
    });
    expect(s).toBe(before);
  });

  it('discards a response from an older request generation for the same node', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 5 });
    const before = s;
    s = rosterReducer(s, {
      type: 'resolved', nodeId: NODE_A, requestId: 4,
      data: { node_id: NODE_A, realm_awake: true, respawn_pending: 0, creatures: [creature('c1')] },
    });
    expect(s).toBe(before);
  });

  it('drops a seed that arrives after movement', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_B, requestId: 2 });
    const before = s;
    s = rosterReducer(s, { type: 'seed', nodeId: NODE_A, requestId: 1, creatures: [creature('c1')] });
    expect(s).toBe(before);
  });
});

describe('roster reducer — realtime', () => {
  it('ignores realtime events until an authoritative roster exists', () => {
    let s = rosterReducer(initialRoster, { type: 'begin', nodeId: NODE_A, requestId: 1 });
    s = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_A, creature: creature('c9') });
    expect(s.creatures).toHaveLength(0);
    expect(s.authoritative).toBe(false);
  });

  it('adds a respawned creature at the current node', () => {
    let s = loaded();
    s = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_A, creature: creature('c2', { spawn_seq: 4 }) });
    expect(s.creatures.map(c => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('removes a creature reported dead and reports empty', () => {
    let s = loaded();
    s = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_A, creature: creature('c1', { is_alive: false }) });
    expect(s.creatures).toHaveLength(0);
    expect(s.status).toBe('empty');
    expect(s.authoritative).toBe(true);
  });

  it('a stale spawn_seq death cannot erase a newer respawn generation', () => {
    let s = loaded();
    // Respawn advanced the generation to 7.
    s = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_A, creature: creature('c1', { spawn_seq: 7 }) });
    // Late death event from generation 1 must not remove it.
    s = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_A, creature: creature('c1', { is_alive: false, spawn_seq: 1 }) });
    expect(s.creatures.map(c => c.id)).toEqual(['c1']);
  });

  it('drops creatures that moved away from the current node', () => {
    let s = loaded();
    s = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_A, creature: creature('c1', { node_id: NODE_B }) });
    expect(s.creatures).toHaveLength(0);
  });

  it('ignores events tagged with a node other than the active one', () => {
    const s = loaded();
    const after = rosterReducer(s, { type: 'realtimeUpsert', nodeId: NODE_B, creature: creature('c3') });
    expect(after).toBe(s);
  });
});

// ── Static authority audit ───────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '__snapshots__']);
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
function code(p: string): string {
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('client never invokes the internal catch-up endpoint', () => {
  it("has no 'combat-catchup' invocation anywhere in src/", () => {
    const offenders = walk('src')
      .filter(f => !f.includes('/test/'))
      .filter(f => /['"`]combat-catchup['"`]/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it('the roster RPC is the only authoritative roster source in useCreatures', () => {
    const src = code('src/features/creatures/hooks/useCreatures.ts');
    expect(src).toContain("supabase.rpc('node_creature_roster'");
    // A node id may never be passed to the roster RPC.
    expect(src).not.toMatch(/node_creature_roster[\s\S]{0,120}_node_id/);
    // Only the reducer owns roster contents.
    expect(src).not.toContain('setCreatures(');
  });
});
