import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'supabase/migrations/20260831114000_combat2_due_nodes.sql';
const SQL = readFileSync(PATH, 'utf8');
const NORMAL = SQL.replace(/\s+/g, ' ').toLowerCase();

interface Row {
  id: string;
  nodeId: string;
  status: 'active' | 'ended';
  dueAt: number;
  claimedTick: number | null;
  claimExpiresAt: number | null;
}

function selectDue(rows: Row[], now: number, requested = 10): Row[] {
  const limit = Math.min(Math.max(requested, 1), 25);
  return rows
    .filter((row) => row.status === 'active' && row.dueAt <= now &&
      (row.claimedTick === null || row.claimExpiresAt === null || row.claimExpiresAt <= now))
    .sort((a, b) => a.dueAt - b.dueAt || a.nodeId.localeCompare(b.nodeId))
    .slice(0, limit);
}

describe('combat2_due_nodes migration contract', () => {
  it('is read-only, service-role-only, security definer with a fixed search path', () => {
    expect(NORMAL).toContain('security definer set search_path = public');
    expect(NORMAL).toContain('stable');
    expect(NORMAL).not.toMatch(/\b(update|insert|delete)\s+public\.node_encounter\b/);
    expect(NORMAL).not.toContain('for update');
    expect(NORMAL).toContain('revoke all on function public.combat2_due_nodes(integer) from public');
    expect(NORMAL).toContain('revoke all on function public.combat2_due_nodes(integer) from anon');
    expect(NORMAL).toContain('revoke all on function public.combat2_due_nodes(integer) from authenticated');
    expect(NORMAL).toContain('grant execute on function public.combat2_due_nodes(integer) to service_role');
  });

  it('uses the established mode and world gates', () => {
    expect(NORMAL).toContain('if not public.combat_mode_is_open()');
    expect(NORMAL).toContain("'kind', 'maintenance'");
    expect(NORMAL).toContain('if not public.world_state_is_awake()');
    expect(NORMAL).toContain("'kind', 'world_asleep'");
  });

  it('matches claim timing, stable ordering, and bounded limits without mutating input', () => {
    expect(NORMAL).toContain("e.status = 'active'");
    expect(NORMAL).toContain('e.next_due_at <= now()');
    expect(NORMAL).toContain('e.claimed_tick is null or e.claim_expires_at is null or e.claim_expires_at <= now()');
    expect(NORMAL).toContain('order by e.next_due_at, e.node_id');
    expect(NORMAL).toContain('coalesce(_limit, 10)');
    expect(NORMAL).toContain('least(greatest(coalesce(_limit, 10), 1), 25)');

    const now = 100;
    const rows: Row[] = [
      { id: 'e3', nodeId: 'n3', status: 'active', dueAt: 50, claimedTick: null, claimExpiresAt: null },
      { id: 'e1', nodeId: 'n1', status: 'active', dueAt: 20, claimedTick: null, claimExpiresAt: null },
      { id: 'e2', nodeId: 'n2', status: 'active', dueAt: 20, claimedTick: 2, claimExpiresAt: 99 },
      { id: 'ended', nodeId: 'n0', status: 'ended', dueAt: 1, claimedTick: null, claimExpiresAt: null },
      { id: 'future', nodeId: 'n4', status: 'active', dueAt: 101, claimedTick: null, claimExpiresAt: null },
      { id: 'leased', nodeId: 'n5', status: 'active', dueAt: 10, claimedTick: 2, claimExpiresAt: 101 },
    ];
    const before = structuredClone(rows);
    expect(selectDue(rows, now).map((row) => row.nodeId)).toEqual(['n1', 'n2', 'n3']);
    expect(rows).toEqual(before);
    expect(selectDue(Array.from({ length: 30 }, (_, index) => ({
      id: `e${index}`, nodeId: `n${index.toString().padStart(2, '0')}`, status: 'active' as const,
      dueAt: index, claimedTick: null, claimExpiresAt: null,
    })), 100, 99)).toHaveLength(25);
  });

  it('returns only minimal structured scheduling fields and one row per unique node', () => {
    expect(NORMAL).toContain("'node_id', due.node_id");
    expect(NORMAL).toContain("'encounter_id', due.id");
    expect(NORMAL).toContain("'next_due_at', due.next_due_at");
    expect(NORMAL).toContain("'candidate_count', jsonb_array_length(v_candidates)");
    const schema = readFileSync('supabase/migrations/20260828234135_aa140c12-7391-4e61-be4f-f74345668e96.sql', 'utf8');
    expect(schema).toContain('node_id uuid NOT NULL UNIQUE');
  });
});
