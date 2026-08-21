/**
 * Phase 2 regression test — does an Orbs of Fire / Ignite stack actually climb?
 *
 * The observed log showed `[2/5]` repeating tick after tick. This drives the
 * real resolver across consecutive ticks and feeds each tick's committed
 * `effectUpserts` back into the next snapshot exactly as
 * `commit_encounter_tick_v2` persists them (ON CONFLICT (source_id, target_id,
 * effect_type) DO UPDATE SET stacks = EXCLUDED.stacks), so a stall here is a
 * resolver defect, not a SQL one.
 *
 * EVIDENCE CLASS: executable resolver/reference test. The `commit` helper is a
 * faithful reference mirror of the deployed conflict identity and update list —
 * it is NOT proof that the deployed SQL executes correctly. Live database
 * evidence is reported separately.
 *
 * STATUS: this file FAILS against the current implementation on purpose. It is
 * the failing-before half of the approved-pending stacks-writeback correction
 * (resolver.ts periodic-schedule writeback re-sends the stale snapshot stack
 * count and the identity merge takes the later row).
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import type { EffectSnapshot, StackApplierSnapshot } from '@/shared/combat/pure/types';
import { snapshot, participant, creature } from './fixtures';

const applier: StackApplierSnapshot = {
  abilityKey: 'ignite',
  effectType: 'ignite',
  trigger: 'successful_pulse_hit',
  chance: 1,
  dotPerTick: 9,
  durationMs: 33000,
  intervalMs: 2000,
  maxStacks: 5,
  damageType: 'fire',
  pulseDamage: 7,
};

/**
 * Persist one tick's upserts the way the deployed committer does:
 * conflict identity (source_id, target_id, effect_type), stacks and expiry
 * taken from the proposal.
 */
function commit(effects: EffectSnapshot[], tick: ReturnType<typeof resolveTickPure>): EffectSnapshot[] {
  const kept = effects.filter((e) => !tick.effectDeleteIds.includes(e.id));
  const out = [...kept];
  for (const up of tick.effectUpserts) {
    const idx = out.findIndex(
      (e) =>
        e.effectType === up.effectType &&
        e.targetId === up.targetId &&
        e.sourceCharacterId === up.sourceCharacterId,
    );
    const row: EffectSnapshot = {
      id: idx >= 0 ? out[idx].id : `eff-${out.length + 1}`,
      lifetime: up.lifetime ?? 'timed',
      targetKind: up.targetKind,
      targetId: up.targetId,
      effectType: up.effectType,
      stacks: up.stacks,
      amountPerTick: up.amountPerTick,
      expiresAtMs: up.expiresAtMs,
      intervalMs: up.intervalMs,
      nextTickAtMs: up.nextTickAtMs,
      damageType: up.damageType,
      sourceCharacterId: up.sourceCharacterId,
      isPeriodic: true,
      ampPct: 0,
      mechanic: up.mechanic ?? null,
      abilityKey: up.abilityKey,
      maxStacks: up.maxStacks,
    } as EffectSnapshot;
    if (idx >= 0) out[idx] = row;
    else out.push(row);
  }
  return out;
}

function igniteRow(effects: EffectSnapshot[], targetId: string) {
  return effects.find((e) => e.effectType === 'ignite' && e.targetId === targetId) ?? null;
}

function baseSnapshot(creatureIds: string[]) {
  const p = participant({ id: 'c1' });
  return snapshot({
    participants: [{ ...p, buffs: { ...p.buffs, stackAppliers: [applier] } }],
    creatures: creatureIds.map((id) => creature({ id, hp: 4000, maxHp: 4000, ac: 1 })),
    engagements: creatureIds.map((id) => ({
      creatureId: id,
      characterId: 'c1',
      lastActionAtMs: 1_699_999_000_000,
    })),
  });
}

/** Run `ticks` consecutive committed ticks, returning proposals + final rows. */
function runTicks(ticks: number, creatureIds = ['m1']) {
  const base = baseSnapshot(creatureIds);
  let effects: EffectSnapshot[] = [];
  const proposals: ReturnType<typeof resolveTickPure>[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const tick = resolveTickPure({
      ...base,
      nowMs: base.nowMs + i * 2000,
      tickNumber: base.tickNumber + i,
      effects,
    });
    proposals.push(tick);
    effects = commit(effects, tick);
  }
  return { base, effects, proposals };
}

describe('ignite stacks across consecutive committed ticks', () => {
  it('creates stack 1 on first application', () => {
    const { proposals, effects } = runTicks(1);
    const up = proposals[0].effectUpserts.find((e) => e.effectType === 'ignite');
    expect(up?.stacks).toBe(1);
    expect(igniteRow(effects, 'm1')?.stacks).toBe(1);
  });

  it('produces stack 2 on the next committed application', () => {
    const { proposals, effects } = runTicks(2);
    const up = proposals[1].effectUpserts.find((e) => e.effectType === 'ignite');
    expect(up?.stacks).toBe(2);
    expect(igniteRow(effects, 'm1')?.stacks).toBe(2);
  });

  it('produces stack 3 on the following committed application', () => {
    const { proposals, effects } = runTicks(3);
    const up = proposals[2].effectUpserts.find((e) => e.effectType === 'ignite');
    expect(up?.stacks).toBe(3);
    expect(igniteRow(effects, 'm1')?.stacks).toBe(3);
  });

  it('climbs one stack per pulse and stops at the configured cap', () => {
    const { proposals } = runTicks(7);
    const observed = proposals.map(
      (t) => t.effectUpserts.find((e) => e.effectType === 'ignite')?.stacks ?? 0,
    );
    expect(observed).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });

  it('refreshes duration on every application per the current rule', () => {
    const { base, proposals } = runTicks(3);
    const expiries = proposals.map(
      (t) => t.effectUpserts.find((e) => e.effectType === 'ignite')?.expiresAtMs ?? 0,
    );
    // Full-duration refresh from the applying tick's nowMs.
    expect(expiries).toEqual([
      base.nowMs + applier.durationMs,
      base.nowMs + 2000 + applier.durationMs,
      base.nowMs + 4000 + applier.durationMs,
    ]);
  });

  it('feeds the newly committed stack into the next resolver snapshot', () => {
    const base = baseSnapshot(['m1']);
    let effects: EffectSnapshot[] = [];
    const snapshotStacks: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      snapshotStacks.push(igniteRow(effects, 'm1')?.stacks ?? 0);
      const tick = resolveTickPure({
        ...base,
        nowMs: base.nowMs + i * 2000,
        tickNumber: base.tickNumber + i,
        effects,
      });
      effects = commit(effects, tick);
    }
    expect(snapshotStacks).toEqual([0, 1, 2, 3]);
  });

  it('keeps separate targets independent', () => {
    const { effects, proposals } = runTicks(3, ['m1', 'm2']);
    expect(igniteRow(effects, 'm1')?.stacks).toBe(3);
    expect(igniteRow(effects, 'm2')?.stacks).toBe(3);
    // One proposal row per (source, target, effect_type) identity.
    const rows = proposals[2].effectUpserts.filter((e) => e.effectType === 'ignite');
    expect(rows.map((r) => r.targetId).sort()).toEqual(['m1', 'm2']);
  });

  it('is idempotent when the same committed tick is replayed', () => {
    const { proposals, effects } = runTicks(2);
    const replayed = commit(effects, proposals[1]);
    expect(igniteRow(replayed, 'm1')?.stacks).toBe(igniteRow(effects, 'm1')?.stacks);
    expect(replayed.filter((e) => e.effectType === 'ignite')).toHaveLength(1);
  });
});
