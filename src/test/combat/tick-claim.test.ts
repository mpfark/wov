/**
 * tick-claim.test.ts — ownership safety of the encounter tick claim/commit
 * contract.
 *
 * The reference machine below mirrors the SQL in `claim_encounter_tick` /
 * `commit_encounter_tick` statement for statement. It exists so the safety
 * rules are executable: no lease for a mode the caller cannot run, unique
 * claim token per grant, late commits refused, and exactly one ownership
 * model writing a given encounter.
 */

import { describe, it, expect } from 'vitest';
import {
  LIVE_MODES,
  EFFECTS_ONLY_MODES,
  isClaimGranted,
  isCommitted,
  supportsMode,
  type ClaimResult,
  type CommitResult,
  type TickMode,
} from '@/shared/combat/tick-claim';

interface EncounterRow {
  tick_number: number;
  tick_at: number;
  tick_state: 'idle' | 'resolving';
  resolving_tick: number | null;
  tick_mode: TickMode | null;
  claim_token: string | null;
  lease_until: number | null;
  attempt: number;
}

const RATE = 2000;
const LEASE = 5000;

/** In-memory mirror of the two RPCs. */
class TickMachine {
  now = 100000;
  private tokenSeq = 0;
  row: EncounterRow = {
    tick_number: 0,
    tick_at: 100000,
    tick_state: 'idle',
    resolving_tick: null,
    tick_mode: null,
    claim_token: null,
    lease_until: null,
    attempt: 0,
  };

  constructor(
    /** Authoritative derived mode, independent of who calls. */
    public derivedMode: TickMode,
  ) {}

  snapshot() {
    return { ...this.row };
  }

  claim(supported: readonly TickMode[]): ClaimResult {
    const r = this.row;

    const mode = this.derivedMode;

    if (r.tick_state === 'resolving' && r.lease_until !== null && r.lease_until > this.now) {
      return { claimed: false, reason: 'in_flight', mode: r.tick_mode };
    }

    if (r.tick_state === 'resolving') {
      if (!supportsMode(r.tick_mode as TickMode, supported)) {
        return { claimed: false, reason: 'mode_refused', mode: r.tick_mode };
      }
      r.claim_token = `t${++this.tokenSeq}`;
      r.lease_until = this.now + LEASE;
      r.attempt += 1;
      return {
        claimed: true,
        tick: r.resolving_tick as number,
        mode: r.tick_mode as TickMode,
        claim_token: r.claim_token,
        attempt: r.attempt,
        reclaimed: true,
      };
    }

    if (!supportsMode(mode, supported)) {
      return { claimed: false, reason: 'mode_refused', mode };
    }
    if (this.now - r.tick_at < RATE) {
      return { claimed: false, reason: 'not_due', mode };
    }

    r.tick_state = 'resolving';
    r.resolving_tick = r.tick_number + 1;
    r.tick_mode = mode;
    r.claim_token = `t${++this.tokenSeq}`;
    r.lease_until = this.now + LEASE;
    r.attempt = 1;
    return {
      claimed: true,
      tick: r.resolving_tick,
      mode,
      claim_token: r.claim_token,
      attempt: 1,
      reclaimed: false,
    };
  }

  commit(tick: number, token: string, batchId: string): CommitResult {
    const r = this.row;
    if (r.tick_number >= tick) {
      return { committed: false, reason: 'already_committed', tick_number: r.tick_number };
    }
    if (r.tick_state !== 'resolving' || r.resolving_tick !== tick || r.claim_token !== token) {
      return { committed: false, reason: 'stale_claim' };
    }
    r.tick_number = tick;
    r.tick_at = r.tick_at + RATE;
    r.tick_state = 'idle';
    r.resolving_tick = null;
    r.claim_token = null;
    r.lease_until = null;
    r.attempt = 0;
    return { committed: true, tick, batch_id: batchId };
  }
}

describe('encounter tick claim ownership', () => {
  it('catch-up cannot claim an authoritatively live tick and captures no lease', () => {
    const m = new TickMachine('live');
    m.now += RATE;
    const before = m.snapshot();

    const res = m.claim(EFFECTS_ONLY_MODES);

    expect(res).toMatchObject({ claimed: false, reason: 'mode_refused', mode: 'live' });
    // no lease, no cursor movement, no resolver identity
    expect(m.snapshot()).toEqual(before);
    expect(m.row.tick_state).toBe('idle');
    expect(m.row.claim_token).toBeNull();
    expect(m.row.lease_until).toBeNull();
    expect(m.row.resolving_tick).toBeNull();
    expect(m.row.attempt).toBe(0);
  });

  it('live combat cannot claim an effects-only tick and captures no lease', () => {
    const m = new TickMachine('effects_only');
    m.now += RATE;

    const res = m.claim(LIVE_MODES);

    expect(res).toMatchObject({ claimed: false, reason: 'mode_refused', mode: 'effects_only' });
    expect(m.row.tick_state).toBe('idle');
    expect(m.row.claim_token).toBeNull();
    expect(m.row.lease_until).toBeNull();
  });

  it('the live resolver claims a live tick, then commits it once', () => {
    const m = new TickMachine('live');
    m.now += RATE;

    const claim = m.claim(LIVE_MODES);
    expect(isClaimGranted(claim)).toBe(true);
    if (!isClaimGranted(claim)) return;
    expect(claim.tick).toBe(1);

    expect(isCommitted(m.commit(claim.tick, claim.claim_token, 'b1'))).toBe(true);
    // replayed commit is a no-op
    expect(m.commit(claim.tick, claim.claim_token, 'b1')).toMatchObject({
      committed: false,
      reason: 'already_committed',
    });
    expect(m.row.tick_number).toBe(1);
  });

  it('a second caller under a live lease is refused as in_flight', () => {
    const m = new TickMachine('live');
    m.now += RATE;
    const first = m.claim(LIVE_MODES);
    expect(isClaimGranted(first)).toBe(true);

    expect(m.claim(LIVE_MODES)).toMatchObject({ claimed: false, reason: 'in_flight' });
  });

  it('resolver A finishing after resolver B reclaimed its lease cannot commit', () => {
    const m = new TickMachine('live');
    m.now += RATE;

    const a = m.claim(LIVE_MODES);
    expect(isClaimGranted(a)).toBe(true);
    if (!isClaimGranted(a)) return;

    // A stalls past its lease; B reclaims the SAME tick with a NEW token
    m.now += LEASE + 1;
    const b = m.claim(LIVE_MODES);
    expect(isClaimGranted(b)).toBe(true);
    if (!isClaimGranted(b)) return;
    expect(b.tick).toBe(a.tick);
    expect(b.reclaimed).toBe(true);
    expect(b.attempt).toBe(2);
    expect(b.claim_token).not.toBe(a.claim_token);

    // A wakes up and tries to commit late
    expect(m.commit(a.tick, a.claim_token, 'batch-a')).toMatchObject({
      committed: false,
      reason: 'stale_claim',
    });
    expect(m.row.tick_number).toBe(0);

    // B commits exactly once
    expect(isCommitted(m.commit(b.tick, b.claim_token, 'batch-b'))).toBe(true);
    expect(m.row.tick_number).toBe(1);
    expect(m.row.tick_state).toBe('idle');
  });

  it('a reclaimed tick keeps its stored mode and is still capability-checked', () => {
    const m = new TickMachine('live');
    m.now += RATE;
    const a = m.claim(LIVE_MODES);
    expect(isClaimGranted(a)).toBe(true);

    m.now += LEASE + 1;
    // participants left mid-tick, so the derived mode changed...
    m.derivedMode = 'effects_only';
    // ...but the stored contract is still live, so catch-up must not take it
    expect(m.claim(EFFECTS_ONLY_MODES)).toMatchObject({
      claimed: false,
      reason: 'mode_refused',
      mode: 'live',
    });
    const retry = m.claim(LIVE_MODES);
    expect(isClaimGranted(retry)).toBe(true);
    if (!isClaimGranted(retry)) return;
    expect(retry.mode).toBe('live');
  });

  it('crash after committing N leaves N durable and N+1 claimable', () => {
    const m = new TickMachine('live');
    m.now += RATE;
    const first = m.claim(LIVE_MODES);
    if (!isClaimGranted(first)) throw new Error('claim failed');
    m.commit(first.tick, first.claim_token, 'b1');

    // resolver died here; next invocation
    m.now += RATE;
    const second = m.claim(LIVE_MODES);
    expect(isClaimGranted(second)).toBe(true);
    if (!isClaimGranted(second)) return;
    expect(second.tick).toBe(2);
    expect(second.reclaimed).toBe(false);
  });

  it('a tick is refused before its rate window elapses', () => {
    const m = new TickMachine('live');
    expect(m.claim(LIVE_MODES)).toMatchObject({ claimed: false, reason: 'not_due' });
  });
});
