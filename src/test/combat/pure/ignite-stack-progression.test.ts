/**
 * Phase 2 stop gate — does an Orbs of Fire / Ignite stack actually climb?
 *
 * The observed log showed `[2/5]` repeating tick after tick. This drives the
 * real resolver across consecutive ticks and feeds each tick's committed
 * `effectUpserts` back into the next snapshot exactly as
 * `commit_encounter_tick_v2` persists them (ON CONFLICT (source_id, target_id,
 * effect_type) DO UPDATE SET stacks = EXCLUDED.stacks), so a stall here is a
 * resolver defect and a pass here means the loss is in snapshot or commit.
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

/** Persist one tick's upserts the way the committer does. */
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

describe('ignite stacks across consecutive committed ticks', () => {
  it('climbs one stack per pulse up to the configured cap', () => {
    const p = participant({ id: 'c1' });
    const base = snapshot({
      participants: [{ ...p, buffs: { ...p.buffs, stackAppliers: [applier] } }],
      creatures: [creature({ id: 'm1', hp: 4000, maxHp: 4000, ac: 1 })],
      engagements: [{ creatureId: 'm1', characterId: 'c1', lastActionAtMs: 1_699_999_000_000 }],
    });

    let effects: EffectSnapshot[] = [];
    const observed: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const nowMs = base.nowMs + i * 2000;
      const tick = resolveTickPure({
        ...base,
        nowMs,
        tickNumber: base.tickNumber + i,
        effects,
      });
      const row = tick.effectUpserts.find((e) => e.effectType === 'ignite');
      observed.push(row?.stacks ?? 0);
      effects = commit(effects, tick);
    }

    expect(observed).toEqual([1, 2, 3, 4, 5, 5, 5]);
  });
});
