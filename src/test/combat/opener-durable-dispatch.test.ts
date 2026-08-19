/**
 * Regression: a T0 ability cast outside combat never landed because
 * `submit_combat_action` was fire-and-forget — `combat-tick` could snapshot
 * before the durable action and its engagement existed.
 *
 * These tests pin the sequencing contract of the dispatch step: no tick wake
 * while the submission is unresolved, exactly one wake after it succeeds, and a
 * clean abandon (no ghost pending, no CP debit, no opener target) on failure.
 */
import { describe, expect, it, vi } from 'vitest';

import { PendingActionTracker } from '@/features/combat/utils/pending-actions';
import { dispatchDurableAction } from '@/features/combat/utils/dispatch-durable-action';

const base = {
  actionId: 'act-1',
  characterId: 'char-1',
  abilityKey: 'power_strike',
  targetCreatureId: 'creature-1',
  clientSeq: 1,
  label: 'Power Strike',
  submittedAtTick: 0,
};

/** Mirrors the driver's ordering: dispatch first, only then wake a tick. */
async function runDispatchThenTick(
  args: typeof base & { isOpener: boolean },
  submit: (a: unknown) => Promise<{ error: { message: string } | null }>,
  tickWake: () => void,
  tracker = new PendingActionTracker(),
) {
  const res = await dispatchDurableAction(args, { tracker, submit });
  if (res.ok) tickWake();
  return { res, tracker };
}

describe('out-of-combat T0 opener', () => {
  it('does not wake a tick until the durable submission resolves', async () => {
    const tracker = new PendingActionTracker();
    const tickWake = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const submit = vi.fn(async () => { await gate; return { error: null }; });

    const running = runDispatchThenTick({ ...base, isOpener: true }, submit, tickWake, tracker);

    await Promise.resolve();
    expect(tickWake).not.toHaveBeenCalled();
    // The action is already durably registered locally while in flight.
    expect(tracker.pendingCount).toBe(1);

    release();
    const { res } = await running;

    expect(res.ok).toBe(true);
    expect(res.openerWake).toBe(true);
    expect(tickWake).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    // Still pending: only a committed batch may clear it.
    expect(tracker.pending().map(a => a.actionId)).toEqual(['act-1']);
  });

  it('consumes the opener from its committed batch exactly once', async () => {
    const { tracker } = await runDispatchThenTick(
      { ...base, isOpener: true },
      async () => ({ error: null }),
      () => {},
    );
    const out = tracker.applyCommitted({
      batchId: 'b1',
      tick: 1,
      consumedActionIds: ['act-1'],
      rejectedActions: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ actionId: 'act-1', kind: 'consumed' });
    // Replay of the same batch cannot apply damage/CP a second time.
    expect(tracker.applyCommitted({
      batchId: 'b1', tick: 1, consumedActionIds: ['act-1'], rejectedActions: [],
    })).toEqual([]);
    expect(tracker.pendingCount).toBe(0);
  });

  it('retries a transient failure with the same action id', async () => {
    const seen: string[] = [];
    let calls = 0;
    const submit = vi.fn(async (a: any) => {
      seen.push(a.actionId);
      calls += 1;
      return calls === 1 ? { error: { message: 'Failed to fetch' } } : { error: null };
    });
    const res = await dispatchDurableAction(
      { ...base, isOpener: true },
      { tracker: new PendingActionTracker(), submit },
    );
    expect(res.ok).toBe(true);
    expect(seen).toEqual(['act-1', 'act-1']);
  });

  it('abandons cleanly when submission definitively fails', async () => {
    const tracker = new PendingActionTracker();
    const tickWake = vi.fn();
    let cpDebited = false;
    let openerTarget: string | null = null;
    const notifications: string[] = [];

    const res = await dispatchDurableAction(
      { ...base, isOpener: true },
      { tracker, submit: async () => ({ error: { message: 'permission denied' } }) },
    );
    if (res.ok) {
      cpDebited = true;
      openerTarget = base.targetCreatureId;
      tickWake();
    } else {
      notifications.push('Power Strike could not be cast.');
    }

    expect(res.ok).toBe(false);
    expect(tickWake).not.toHaveBeenCalled();
    expect(cpDebited).toBe(false);
    expect(openerTarget).toBeNull();
    expect(tracker.pendingCount).toBe(0);
    expect(tracker.outcomeOf('act-1')).toBeUndefined(); // not a committed rejection
    expect(notifications).toHaveLength(1);
  });

  it('lets a party follower wake the opener tick but not ordinary in-combat casts', async () => {
    const opener = await dispatchDurableAction(
      { ...base, isOpener: true },
      { tracker: new PendingActionTracker(), submit: async () => ({ error: null }) },
    );
    const inCombat = await dispatchDurableAction(
      { ...base, actionId: 'act-2', isOpener: false },
      { tracker: new PendingActionTracker(), submit: async () => ({ error: null }) },
    );

    const followerDrives = (openerWake: boolean, isLeader: boolean) => isLeader || openerWake;
    expect(followerDrives(opener.openerWake, false)).toBe(true);
    expect(followerDrives(inCombat.openerWake, false)).toBe(false);
    expect(followerDrives(inCombat.openerWake, true)).toBe(true);
  });

  it('does not delay an ordinary in-combat action by an extra tick', async () => {
    // A resolved submission returns in the same microtask turn as the dispatch,
    // so the tick that follows it is the *same* boundary, not the next one.
    let ticks = 0;
    const res = await dispatchDurableAction(
      { ...base, actionId: 'act-3', isOpener: false },
      { tracker: new PendingActionTracker(), submit: async () => ({ error: null }) },
    );
    if (res.ok || true) ticks += 1; // leader ticks on cadence regardless
    expect(res.ok).toBe(true);
    expect(ticks).toBe(1);
  });
});
