/**
 * Regression: a durably submitted T0 opener was stranded when the first
 * `combat-tick` answered a non-terminal `not_due` / `in_flight` refusal.
 *
 * The local queue entry is consumed by `doTick` before the durable submission,
 * so after the refusal the pacer saw neither combat nor a queued ability and
 * stopped re-arming. The durable action stayed in `combat_actions` and nothing
 * ever woke the tick that would resolve it.
 *
 * These tests pin the corrected contract: the durable opener is pending work in
 * its own right (pacer + request eligibility), it is retired only by a committed
 * outcome, and it never produces a second action id or a second CP debit.
 */
import { describe, expect, it, vi } from 'vitest';

import { PendingActionTracker } from '@/features/combat/utils/pending-actions';
import { dispatchDurableAction } from '@/features/combat/utils/dispatch-durable-action';
import {
  pendingPulse,
  shouldIssueTickRequest,
  shouldPaceNextTick,
} from '@/features/combat/utils/opener-gates';

const MIN_REQUEST_SPACING_MS = 400;

type Refusal =
  | { kind: 'not_due' | 'in_flight'; consumed?: undefined; dead?: undefined }
  | { kind: 'committed'; consumed: string[]; dead?: string[] };

/**
 * Minimal driver mirror: the exact sequencing and gates `useCombatDriver` uses.
 * Deterministic — the "pacer" is a list of scheduled wakes, never a real timer.
 */
class DriverHarness {
  tracker = new PendingActionTracker();
  inCombat = false;
  engaged: string[] = [];
  queued: { index: number; targetId: string; label: string } | null = null;
  opener: { actionId: string; targetId: string; slotIndex: number } | null = null;
  adoptTarget: string | null = null;
  cp = 100;
  cpDebits = 0;
  requests = 0;
  requestTimes: number[] = [];
  submittedIds: string[] = [];
  log: string[] = [];
  attackPressed = false;
  now = 0;
  pulse = pendingPulse({});

  constructor(
    private responses: Refusal[],
    private opts: { isLeader?: boolean; solo?: boolean; submitFails?: boolean; rejectReason?: string } = {},
  ) {}

  private syncPulse() {
    this.pulse = pendingPulse({
      queuedIndex: this.queued ? this.queued.index : null,
      durableSlotIndex: this.tracker.newestPending()?.slotIndex ?? null,
    });
  }

  queueAbility(index: number, targetId: string, label = 'Power Strike') {
    this.queued = { index, targetId, label };
    this.syncPulse();
  }

  /** True when the pacer would arm another wake. */
  get paced(): boolean {
    return shouldPaceNextTick({
      inCombat: this.inCombat,
      hasQueuedAbility: !!this.queued,
      hasDurableOpener: !!this.opener,
    });
  }

  async doTick(): Promise<void> {
    let localCastCount = 0;
    let openerWake = false;
    const pending = this.queued;
    if (pending) {
      this.queued = null;
      const actionId = 'act-1';
      const isOpener = !this.inCombat;
      const res = await dispatchDurableAction(
        {
          actionId,
          characterId: 'char-1',
          abilityKey: 'power_strike',
          targetCreatureId: pending.targetId,
          clientSeq: 1,
          label: pending.label,
          isOpener,
          slotIndex: pending.index,
          submittedAtTick: 0,
        },
        {
          tracker: this.tracker,
          submit: async (a) => {
            this.submittedIds.push(a.actionId);
            return this.opts.submitFails ? { error: { message: 'permission denied' } } : { error: null };
          },
        },
      );
      this.syncPulse();
      if (!res.ok) {
        this.opener = null;
        this.syncPulse();
        this.log.push(`${pending.label} fizzles`);
      } else {
        if (isOpener) {
          this.opener = { actionId, targetId: pending.targetId, slotIndex: pending.index };
          openerWake = true;
        }
        localCastCount += 1;
        this.cp -= 10;
        this.cpDebits += 1;
      }
    }

    const openerAlive = openerWake || !!this.opener;
    const driver = (this.opts.solo ?? true) || !!this.opts.isLeader || openerAlive;
    if (
      shouldIssueTickRequest({
        driver,
        alive: true,
        engagedCount: this.engaged.length,
        localCastCount,
        hasDurableOpener: openerAlive,
      })
    ) {
      this.now += MIN_REQUEST_SPACING_MS + 1;
      this.requests += 1;
      this.requestTimes.push(this.now);
      this.applyResponse(this.responses.shift() ?? { kind: 'not_due' });
    }
  }

  private applyResponse(r: Refusal) {
    if (r.kind === 'not_due' || r.kind === 'in_flight') return; // non-terminal: hold everything
    const outcomes = this.tracker.applyCommitted({
      batchId: `b-${this.requests}`,
      tick: this.requests,
      consumedActionIds: this.opts.rejectReason ? [] : (r.consumed ?? []),
      rejectedActions: this.opts.rejectReason
        ? (r.consumed ?? []).map(id => ({ actionId: id, reason: this.opts.rejectReason! }))
        : [],
    });
    const opener = this.opener;
    if (opener) {
      const mine = outcomes.find(o => o.actionId === opener.actionId);
      if (mine) {
        this.opener = null;
        if (mine.kind === 'consumed') this.adoptTarget = opener.targetId;
        if (mine.kind === 'rejected') this.log.push(`rejected:${mine.reason}`);
      }
    }
    this.syncPulse();

    // Adoption: committed outcome only, never an HP change.
    if (!this.inCombat && this.adoptTarget) {
      const target = this.adoptTarget;
      this.adoptTarget = null;
      const dead = new Set(r.dead ?? []);
      if (!dead.has(target)) {
        this.inCombat = true;
        this.engaged = [target];
      } else {
        this.log.push(`kill:${target}`);
        this.engaged = [];
        this.inCombat = false;
      }
    }
  }

  pressAttack() {
    this.attackPressed = true;
  }
}

describe('durable T0 opener across a non-terminal refusal', () => {
  it('awaits durable submission before the first tick request', async () => {
    let released = false;
    const tracker = new PendingActionTracker();
    const submit = vi.fn(async () => {
      released = true;
      return { error: null };
    });
    const res = await dispatchDurableAction(
      {
        actionId: 'a1', characterId: 'c', abilityKey: 'power_strike',
        targetCreatureId: 'cr1', clientSeq: 1, label: 'Power Strike',
        isOpener: true, slotIndex: 0, submittedAtTick: 0,
      },
      { tracker, submit },
    );
    expect(released).toBe(true);
    expect(res.ok).toBe(true);
    expect(tracker.newestPending()?.slotIndex).toBe(0);
  });

  it('keeps the opener alive through not_due and consumes it once on the due tick', async () => {
    const h = new DriverHarness([{ kind: 'not_due' }, { kind: 'committed', consumed: ['act-1'] }]);
    h.queueAbility(1, 'cr1');
    await h.doTick();

    // First response refused: no combat yet, but the pacer still has work.
    expect(h.inCombat).toBe(false);
    expect(h.opener).not.toBeNull();
    expect(h.paced).toBe(true);

    await h.doTick(); // the later paced tick
    expect(h.requests).toBe(2);
    expect(h.inCombat).toBe(true);
    expect(h.engaged).toEqual(['cr1']);
    expect(h.submittedIds).toEqual(['act-1']);
    expect(h.cpDebits).toBe(1);
    expect(h.tracker.pendingCount).toBe(0);
    expect(h.attackPressed).toBe(false);
  });

  it('does not strand the opener on an in_flight refusal', async () => {
    const h = new DriverHarness([
      { kind: 'in_flight' }, { kind: 'in_flight' }, { kind: 'committed', consumed: ['act-1'] },
    ]);
    h.queueAbility(0, 'cr1');
    await h.doTick();
    await h.doTick();
    expect(h.paced).toBe(true);
    await h.doTick();
    expect(h.inCombat).toBe(true);
    expect(h.submittedIds).toEqual(['act-1']); // never a second action id
  });

  it('starts combat on a committed miss with no HP change reported', async () => {
    // `creature_states` carries no entry for the unchanged creature at all.
    const h = new DriverHarness([{ kind: 'committed', consumed: ['act-1'] }]);
    h.queueAbility(0, 'cr1');
    await h.doTick();
    expect(h.inCombat).toBe(true);
    expect(h.engaged).toEqual(['cr1']);
  });

  it('applies a one-shot kill once and then stops cleanly', async () => {
    const h = new DriverHarness([{ kind: 'committed', consumed: ['act-1'], dead: ['cr1'] }]);
    h.queueAbility(0, 'cr1');
    await h.doTick();
    expect(h.log).toEqual(['kill:cr1']);
    expect(h.inCombat).toBe(false);
    expect(h.paced).toBe(false);
    expect(h.tracker.pendingCount).toBe(0);
  });

  it('does not start combat on an authoritative rejection', async () => {
    const h = new DriverHarness([{ kind: 'committed', consumed: ['act-1'] }], { rejectReason: 'target_dead' });
    h.queueAbility(0, 'cr1');
    await h.doTick();
    expect(h.inCombat).toBe(false);
    expect(h.opener).toBeNull();
    expect(h.log).toEqual(['rejected:target_dead']);
    expect(h.pulse.index).toBeNull();
    expect(h.paced).toBe(false);
  });

  it('works for solo, leader and follower openers', async () => {
    for (const opts of [{ solo: true }, { solo: false, isLeader: true }, { solo: false, isLeader: false }]) {
      const h = new DriverHarness([{ kind: 'not_due' }, { kind: 'committed', consumed: ['act-1'] }], opts);
      h.queueAbility(0, 'cr1');
      await h.doTick();
      await h.doTick();
      expect(h.inCombat).toBe(true);
    }
  });

  it('never issues two requests inside the hard request floor', async () => {
    const h = new DriverHarness([
      { kind: 'not_due' }, { kind: 'not_due' }, { kind: 'committed', consumed: ['act-1'] },
    ]);
    h.queueAbility(0, 'cr1');
    await h.doTick();
    await h.doTick();
    await h.doTick();
    for (let i = 1; i < h.requestTimes.length; i++) {
      expect(h.requestTimes[i] - h.requestTimes[i - 1]).toBeGreaterThanOrEqual(MIN_REQUEST_SPACING_MS);
    }
  });

  it('abandons cleanly when durable submission definitively fails', async () => {
    const h = new DriverHarness([{ kind: 'committed', consumed: ['act-1'] }], { submitFails: true });
    h.queueAbility(0, 'cr1');
    await h.doTick();
    expect(h.requests).toBe(0);
    expect(h.cpDebits).toBe(0);
    expect(h.opener).toBeNull();
    expect(h.pulse.index).toBeNull();
    expect(h.paced).toBe(false);
  });
});

describe('pending ability pulse lifecycle', () => {
  it('pulses immediately, through submission and until the committed outcome', async () => {
    const h = new DriverHarness([{ kind: 'not_due' }, { kind: 'committed', consumed: ['act-1'] }]);
    h.queueAbility(2, 'cr1');
    expect(h.pulse).toEqual({ index: 2, stage: 'preparing' });

    await h.doTick();
    // Submitted, awaiting a committed tick across the not_due refusal.
    expect(h.pulse).toEqual({ index: 2, stage: 'submitted' });

    await h.doTick();
    expect(h.pulse).toEqual({ index: null, stage: null });
  });

  it('clears on rejection, supersession and abandon', () => {
    const t = new PendingActionTracker();
    const project = () => pendingPulse({ durableSlotIndex: t.newestPending()?.slotIndex ?? null });

    t.submit({ actionId: 'a1', abilityKey: 'k', label: 'A', clientSeq: 1, submittedAtTick: 0, slotIndex: 1 });
    expect(project().index).toBe(1);
    t.submit({ actionId: 'a2', abilityKey: 'k', label: 'B', clientSeq: 2, submittedAtTick: 0, slotIndex: 3 });
    // Supersession transfers the pulse to the newest activation.
    expect(project()).toEqual({ index: 3, stage: 'submitted' });

    t.applyCommitted({ batchId: 'b', tick: 1, consumedActionIds: [], rejectedActions: [{ actionId: 'a2', reason: 'no_target' }] });
    expect(project().index).toBeNull();

    t.reset();
    t.submit({ actionId: 'a3', abilityKey: 'k', label: 'C', clientSeq: 3, submittedAtTick: 0, slotIndex: 0 });
    t.abandon('a3');
    expect(project().index).toBeNull();
  });

  it('cannot stay stuck across a combat reset', () => {
    const t = new PendingActionTracker();
    t.submit({ actionId: 'a1', abilityKey: 'k', label: 'A', clientSeq: 1, submittedAtTick: 0, slotIndex: 2 });
    t.reset();
    expect(pendingPulse({ durableSlotIndex: t.newestPending()?.slotIndex ?? null }).index).toBeNull();
  });

  it('is feedback only — projecting it issues no submission or request', async () => {
    const h = new DriverHarness([{ kind: 'committed', consumed: ['act-1'] }]);
    h.queueAbility(0, 'cr1');
    expect(h.pulse.stage).toBe('preparing');
    expect(h.requests).toBe(0);
    expect(h.submittedIds).toEqual([]);
    expect(h.cpDebits).toBe(0);
  });
});
