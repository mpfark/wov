/**
 * The scheduling half of the claim/commit contract.
 *
 * Two layers are pinned here, deliberately separately:
 *
 *  1. A reference machine mirroring `claim_encounter_tick`,
 *     `release_encounter_tick` and the fenced `commit_encounter_tick_v3`
 *     statement for statement, so the *semantics* (phase-preserving advance,
 *     rollback on release, boundary fence, reservation cleared on commit,
 *     reclaim-then-late-commit) are executable.
 *
 *  2. Assertions against the checked-in migration SQL, so the deployed function
 *     text cannot drift away from those semantics unnoticed.
 *
 * Honest scope note: this environment cannot execute database functions (the
 * exec role is intentionally denied EXECUTE), so layer 2 is a text contract on
 * the migration, not an in-database run. Nothing here should be read as proof
 * that the deployed plpgsql executed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const RATE = 2000;
const LEASE = 5000;

type ClaimAnswer =
  | { claimed: false; reason: 'not_due' | 'in_flight'; now_ms: number; boundary_at_ms: number; next_due_at_ms: number }
  | {
      claimed: true;
      tick: number;
      claim_token: string;
      now_ms: number;
      boundary_at_ms: number;
      next_due_at_ms: number;
      reclaimed: boolean;
    };

type CommitAnswer =
  | { committed: false; reason: 'stale_claim' | 'already_committed' | 'boundary_conflict' }
  | { committed: true; tick: number; committed_at_ms: number; next_due_at_ms: number };

/** Reference machine for the schedule-owning half of the two RPCs. */
class ScheduleMachine {
  now = 100_000;
  private seq = 0;
  row = {
    tick_number: 0,
    tick_state: 'idle' as 'idle' | 'resolving',
    resolving_tick: null as number | null,
    claim_token: null as string | null,
    lease_until: null as number | null,
    next_tick_due_at: 100_000,
    reserved_boundary_at: null as number | null,
  };

  claim(): ClaimAnswer {
    const r = this.row;
    if (r.tick_state === 'resolving' && r.lease_until !== null && r.lease_until > this.now) {
      return {
        claimed: false,
        reason: 'in_flight',
        now_ms: this.now,
        boundary_at_ms: r.reserved_boundary_at ?? r.next_tick_due_at,
        next_due_at_ms: r.next_tick_due_at,
      };
    }
    if (r.tick_state === 'resolving') {
      // Reclaim: the SAME boundary is still reserved, a NEW token is issued.
      r.claim_token = `t${++this.seq}`;
      r.lease_until = this.now + LEASE;
      return {
        claimed: true,
        tick: r.resolving_tick as number,
        claim_token: r.claim_token,
        now_ms: this.now,
        boundary_at_ms: r.reserved_boundary_at as number,
        next_due_at_ms: r.next_tick_due_at,
        reclaimed: true,
      };
    }
    if (this.now < r.next_tick_due_at) {
      return {
        claimed: false,
        reason: 'not_due',
        now_ms: this.now,
        boundary_at_ms: r.next_tick_due_at,
        next_due_at_ms: r.next_tick_due_at,
      };
    }
    // Phase-preserving advance: from the boundary consumed, never from `now`.
    const boundary = r.next_tick_due_at;
    r.reserved_boundary_at = boundary;
    r.next_tick_due_at = boundary + RATE;
    r.tick_state = 'resolving';
    r.resolving_tick = r.tick_number + 1;
    r.claim_token = `t${++this.seq}`;
    r.lease_until = this.now + LEASE;
    return {
      claimed: true,
      tick: r.resolving_tick,
      claim_token: r.claim_token,
      now_ms: this.now,
      boundary_at_ms: boundary,
      next_due_at_ms: r.next_tick_due_at,
      reclaimed: false,
    };
  }

  release(tick: number, token: string) {
    const r = this.row;
    if (r.tick_state !== 'resolving' || r.resolving_tick !== tick || r.claim_token !== token) {
      return { released: false };
    }
    // Rollback: the interval is handed back, not forfeited.
    if (r.reserved_boundary_at !== null) r.next_tick_due_at = r.reserved_boundary_at;
    r.reserved_boundary_at = null;
    r.tick_state = 'idle';
    r.resolving_tick = null;
    r.claim_token = null;
    r.lease_until = null;
    return { released: true };
  }

  commit(tick: number, token: string, reservedBoundaryAt: number | null): CommitAnswer {
    const r = this.row;
    if (r.tick_number >= tick) return { committed: false, reason: 'already_committed' };
    if (r.tick_state !== 'resolving' || r.resolving_tick !== tick || r.claim_token !== token) {
      return { committed: false, reason: 'stale_claim' };
    }
    if (
      reservedBoundaryAt !== null &&
      r.reserved_boundary_at !== null &&
      r.reserved_boundary_at !== reservedBoundaryAt
    ) {
      return { committed: false, reason: 'boundary_conflict' };
    }
    r.tick_number = tick;
    r.tick_state = 'idle';
    r.resolving_tick = null;
    r.claim_token = null;
    r.lease_until = null;
    r.reserved_boundary_at = null; // reservation consumed
    // The schedule is NOT recomputed here: commit latency must never enter it.
    return {
      committed: true,
      tick,
      committed_at_ms: this.now,
      next_due_at_ms: r.next_tick_due_at,
    };
  }
}

describe('claim/commit schedule semantics (reference machine)', () => {
  it('advances the schedule from the consumed boundary, not from the claim time', () => {
    const m = new ScheduleMachine();
    m.now = 100_900; // 900ms late
    const c = m.claim();
    expect(c.claimed).toBe(true);
    if (!c.claimed) return;
    expect(c.boundary_at_ms).toBe(100_000);
    expect(c.next_due_at_ms).toBe(102_000);
    expect(m.row.reserved_boundary_at).toBe(100_000);
  });

  it('reports the post-commit clock and the next boundary, and clears the reservation', () => {
    const m = new ScheduleMachine();
    m.now = 100_000;
    const c = m.claim();
    if (!c.claimed) throw new Error('claim refused');
    m.now = 100_800; // commit happens 800ms later
    const res = m.commit(c.tick, c.claim_token, c.boundary_at_ms);
    expect(res).toEqual({
      committed: true,
      tick: 1,
      committed_at_ms: 100_800,
      next_due_at_ms: 102_000,
    });
    expect(m.row.reserved_boundary_at).toBeNull();
  });

  it('does not let commit latency lengthen the interval', () => {
    const m = new ScheduleMachine();
    const commits: number[] = [];
    for (let i = 0; i < 10; i++) {
      m.now = 100_000 + i * RATE; // request arrives exactly on the boundary
      const c = m.claim();
      if (!c.claimed) throw new Error('claim refused');
      m.now += 900; // slow commit
      const res = m.commit(c.tick, c.claim_token, c.boundary_at_ms);
      expect(res.committed).toBe(true);
      if (res.committed) commits.push(res.next_due_at_ms);
    }
    for (let i = 1; i < commits.length; i++) {
      expect(commits[i] - commits[i - 1]).toBe(RATE);
    }
  });

  it('restores the boundary on release so a failed tick forfeits no interval', () => {
    const m = new ScheduleMachine();
    const c = m.claim();
    if (!c.claimed) throw new Error('claim refused');
    expect(m.row.next_tick_due_at).toBe(102_000);
    m.release(c.tick, c.claim_token);
    expect(m.row.next_tick_due_at).toBe(100_000);
    expect(m.row.reserved_boundary_at).toBeNull();
    // The very next request is due immediately, on the original phase.
    const again = m.claim();
    expect(again.claimed).toBe(true);
    if (!again.claimed) return;
    expect(again.boundary_at_ms).toBe(100_000);
  });

  it('refuses a not-due claim but still names the authoritative boundary', () => {
    const m = new ScheduleMachine();
    m.now = 99_500;
    const c = m.claim();
    expect(c.claimed).toBe(false);
    if (c.claimed) return;
    expect(c.reason).toBe('not_due');
    expect(c.next_due_at_ms).toBe(100_000);
    expect(c.now_ms).toBe(99_500);
  });

  it('refuses a second claimer under a live lease', () => {
    const m = new ScheduleMachine();
    const first = m.claim();
    expect(first.claimed).toBe(true);
    const second = m.claim();
    expect(second.claimed).toBe(false);
    if (second.claimed) return;
    expect(second.reason).toBe('in_flight');
  });

  it('fences a late commit from a resolver whose lease was reclaimed', () => {
    const m = new ScheduleMachine();
    const a = m.claim();
    if (!a.claimed) throw new Error('claim refused');
    m.now += LEASE + 1;
    const b = m.claim();
    if (!b.claimed) throw new Error('reclaim refused');
    expect(b.reclaimed).toBe(true);
    expect(b.boundary_at_ms).toBe(a.boundary_at_ms);
    expect(b.claim_token).not.toBe(a.claim_token);
    // A's token is gone, so the token check already rejects it.
    expect(m.commit(a.tick, a.claim_token, a.boundary_at_ms)).toEqual({
      committed: false,
      reason: 'stale_claim',
    });
    expect(m.commit(b.tick, b.claim_token, b.boundary_at_ms).committed).toBe(true);
  });

  it('refuses a commit naming a boundary that is no longer the reserved one', () => {
    const m = new ScheduleMachine();
    const c = m.claim();
    if (!c.claimed) throw new Error('claim refused');
    expect(m.commit(c.tick, c.claim_token, c.boundary_at_ms - RATE)).toEqual({
      committed: false,
      reason: 'boundary_conflict',
    });
    // Nothing landed, and the reservation is untouched.
    expect(m.row.tick_number).toBe(0);
    expect(m.row.reserved_boundary_at).toBe(c.boundary_at_ms);
  });

  it('treats a replayed commit as already committed', () => {
    const m = new ScheduleMachine();
    const c = m.claim();
    if (!c.claimed) throw new Error('claim refused');
    expect(m.commit(c.tick, c.claim_token, c.boundary_at_ms).committed).toBe(true);
    expect(m.commit(c.tick, c.claim_token, c.boundary_at_ms)).toEqual({
      committed: false,
      reason: 'already_committed',
    });
  });
});

describe('deployed commit SQL matches those semantics', () => {
  const dir = join(process.cwd(), 'supabase/migrations');
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .filter((t) => t.includes('commit_encounter_tick_v3'))
    .join('\n');

  it('has a fenced commit entry point', () => {
    expect(sql).toContain('commit_encounter_tick_v3');
    expect(sql).toContain('_reserved_boundary_at bigint DEFAULT NULL');
  });

  it('refuses on a boundary mismatch before committing anything', () => {
    const fence = sql.indexOf("'boundary_conflict'");
    const inner = sql.indexOf('public.commit_encounter_tick_v2(');
    expect(fence).toBeGreaterThan(-1);
    expect(inner).toBeGreaterThan(fence);
  });

  it('clears the reservation and reports the pacing pair on success', () => {
    expect(sql).toContain('SET reserved_boundary_at = NULL');
    expect(sql).toContain('RETURNING next_tick_due_at INTO v_next_due');
    expect(sql).toContain("'committed_at_ms'");
    expect(sql).toContain("'next_due_at_ms'");
  });

  it('never recomputes the schedule from commit time', () => {
    expect(sql).not.toMatch(/SET[^;]*next_tick_due_at\s*=/);
  });

  it('takes the encounter lock and row lock before deciding', () => {
    expect(sql).toContain('pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id))');
    expect(sql).toContain('FOR UPDATE');
  });

  it('is not callable by app users', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.commit_encounter_tick_v3');
    expect(sql).toContain('TO service_role');
  });
});
