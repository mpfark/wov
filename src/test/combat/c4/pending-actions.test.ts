/**
 * C4 durable action acknowledgement.
 *
 * submitted → pending → consumed | rejected | superseded, cleared only by a
 * committed batch, matched by stable action id.
 */
import { describe, expect, it } from 'vitest';

import { PendingActionTracker, describeRejection } from '@/features/combat/utils/pending-actions';

const action = (id: string, seq: number, tick = 0) => ({
  actionId: id,
  abilityKey: 'rend',
  label: 'Rend',
  clientSeq: seq,
  submittedAtTick: tick,
});

const batch = (
  batchId: string,
  tick: number,
  consumed: string[] = [],
  rejected: { actionId: string; reason: string }[] = [],
) => ({ batchId, tick, consumedActionIds: consumed, rejectedActions: rejected });

describe('PendingActionTracker', () => {
  it('marks a consumed action complete exactly once', () => {
    const t = new PendingActionTracker();
    t.submit(action('a1', 1));
    expect(t.pendingCount).toBe(1);

    const first = t.applyCommitted(batch('b1', 5, ['a1']));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ actionId: 'a1', kind: 'consumed', tick: 5 });
    expect(t.pendingCount).toBe(0);

    // Same batch again (realtime + recovery replay) → no second acknowledgement.
    expect(t.applyCommitted(batch('b1', 5, ['a1']))).toEqual([]);
    // A *different* batch repeating the id also cannot re-acknowledge.
    expect(t.applyCommitted(batch('b2', 6, ['a1']))).toEqual([]);
  });

  it('clears a rejected action once and exposes the authoritative reason', () => {
    const t = new PendingActionTracker();
    t.submit(action('a1', 1));
    const out = t.applyCommitted(batch('b1', 3, [], [{ actionId: 'a1', reason: 'insufficient_cp' }]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'rejected', reason: 'insufficient_cp' });
    expect(describeRejection('insufficient_cp')).toBe('not enough CP');
    expect(t.pendingCount).toBe(0);
    expect(t.applyCommitted(batch('b1', 3, [], [{ actionId: 'a1', reason: 'insufficient_cp' }]))).toEqual([]);
  });

  it('matches by action id, not ability key or order', () => {
    const t = new PendingActionTracker();
    t.submit(action('a1', 1));
    t.submit({ ...action('a2', 2), label: 'Rend' });
    const out = t.applyCommitted(batch('b1', 4, ['a2']));
    expect(Object.fromEntries(out.map(o => [o.actionId, o.kind]))).toEqual({
      a2: 'consumed',
      a1: 'superseded',
    });
    // a1 was superseded by a2 and closed in the same committed application.
    expect(t.outcomeOf('a1')).toMatchObject({ kind: 'superseded' });
  });

  it('distinguishes a superseded action from an executed one', () => {
    const t = new PendingActionTracker();
    t.submit(action('old', 1, 10));
    t.submit(action('new', 2, 10));
    const out = t.applyCommitted(batch('b1', 11, ['new']));
    const kinds = Object.fromEntries(out.map(o => [o.actionId, o.kind]));
    expect(kinds).toEqual({ new: 'consumed', old: 'superseded' });

    // A superseded action the server *did* execute is reported as consumed.
    const t2 = new PendingActionTracker();
    t2.submit(action('old', 1, 10));
    t2.submit(action('new', 2, 10));
    const out2 = t2.applyCommitted(batch('b1', 11, ['old', 'new']));
    expect(Object.fromEntries(out2.map(o => [o.actionId, o.kind]))).toEqual({
      old: 'consumed',
      new: 'consumed',
    });
  });

  it('keeps the action pending when the HTTP response is lost', () => {
    const t = new PendingActionTracker();
    t.submit(action('a1', 1));
    // No committed batch arrives at all (response dropped, no realtime yet).
    expect(t.pending().map(a => a.actionId)).toEqual(['a1']);
    // It resolves later from the committed stream, out of band.
    expect(t.applyCommitted(batch('late', 9, ['a1']))[0].kind).toBe('consumed');
  });

  it('keeps an action submitted after the snapshot pending', () => {
    const t = new PendingActionTracker();
    t.submit(action('a1', 1, 20)); // submitted while tick 20 was the latest known
    // Tick 20 was resolved from a snapshot taken before submission.
    expect(t.applyCommitted(batch('b20', 20))).toEqual([]);
    expect(t.pendingCount).toBe(1);
    // The next tick sees it.
    expect(t.applyCommitted(batch('b21', 21, ['a1']))[0].kind).toBe('consumed');
  });

  it('converges two tabs of the same character on the same committed outcome', () => {
    const tabA = new PendingActionTracker();
    const tabB = new PendingActionTracker();
    tabA.submit(action('a1', 1)); // only tab A dispatched it

    const committed = [
      batch('b1', 5, ['a1']),
      batch('b2', 6, [], [{ actionId: 'a2', reason: 'target_dead' }]),
      batch('b2', 6, [], [{ actionId: 'a2', reason: 'target_dead' }]), // duplicate
    ];
    for (const b of committed) { tabA.applyCommitted(b); tabB.applyCommitted(b); }

    expect(tabA.ledgerEntries()).toEqual(tabB.ledgerEntries());
    expect(tabA.pendingCount).toBe(0);
    expect(tabB.pendingCount).toBe(0);
  });

  it('closes pending actions as superseded on authoritative re-anchor', () => {
    const t = new PendingActionTracker();
    t.submit(action('a1', 1, 4));
    const out = t.reanchor(30);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('superseded');
    expect(t.pendingCount).toBe(0);
  });
});
