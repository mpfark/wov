import { describe, it } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import type { EffectSnapshot, StackApplierSnapshot } from '@/shared/combat/pure/types';
import { snapshot, participant, creature } from '@/test/combat/pure/fixtures';

const applier: StackApplierSnapshot = {
  abilityKey: 'ignite', effectType: 'ignite', trigger: 'successful_pulse_hit',
  chance: 1, dotPerTick: 9, durationMs: 33000, intervalMs: 2000,
  maxStacks: 5, damageType: 'fire', pulseDamage: 7,
};

function commit(effects: EffectSnapshot[], tick: any): EffectSnapshot[] {
  const kept = effects.filter((e) => !tick.effectDeleteIds.includes(e.id));
  const out = [...kept];
  for (const up of tick.effectUpserts) {
    const idx = out.findIndex((e) => e.effectType === up.effectType && e.targetId === up.targetId && e.sourceCharacterId === up.sourceCharacterId);
    const row = { id: idx >= 0 ? out[idx].id : `eff-${out.length + 1}`, lifetime: up.lifetime ?? 'timed', targetKind: up.targetKind, targetId: up.targetId, effectType: up.effectType, stacks: up.stacks, amountPerTick: up.amountPerTick, expiresAtMs: up.expiresAtMs, intervalMs: up.intervalMs, nextTickAtMs: up.nextTickAtMs, damageType: up.damageType, sourceCharacterId: up.sourceCharacterId, isPeriodic: true, ampPct: 0, mechanic: up.mechanic ?? null, abilityKey: up.abilityKey, maxStacks: up.maxStacks } as EffectSnapshot;
    if (idx >= 0) out[idx] = row; else out.push(row);
  }
  return out;
}

describe('probe', () => {
  it('prints per-layer stack values', () => {
    const p = participant({ id: 'c1' });
    const base = snapshot({
      participants: [{ ...p, buffs: { ...p.buffs, stackAppliers: [applier] } }],
      creatures: [creature({ id: 'm1', hp: 4000, maxHp: 4000, ac: 1 })],
      engagements: [{ creatureId: 'm1', characterId: 'c1', lastActionAtMs: 1_699_999_000_000 }],
    });
    let effects: EffectSnapshot[] = [];
    for (let i = 0; i < 5; i += 1) {
      const nowMs = base.nowMs + i * 2000;
      const snapIn = effects.map((e) => `${e.effectType}/${e.sourceCharacterId}/${e.targetId} stacks=${e.stacks} next=${e.nextTickAtMs - base.nowMs} exp=${e.expiresAtMs - base.nowMs} mech=${e.mechanic}`);
      const tick = resolveTickPure({ ...base, nowMs, tickNumber: base.tickNumber + i, effects });
      const ups = tick.effectUpserts.filter((e: any) => e.effectType === 'ignite').map((e: any) => `stacks=${e.stacks} exp=${e.expiresAtMs - base.nowMs} next=${e.nextTickAtMs - base.nowMs} src=${e.sourceCharacterId} mech=${e.mechanic}`);
      const evs = tick.events.filter((e: any) => e.type === 'stack_applied' || e.type === 'stance_pulse' || e.type === 'dot_tick').map((e: any) => `${e.type}:${e.message}`);
      console.log(`--- tick ${i} nowMs+${nowMs - base.nowMs}`);
      console.log('  snapshot in :', JSON.stringify(snapIn));
      console.log('  upserts     :', JSON.stringify(ups));
      console.log('  events      :', JSON.stringify(evs));
      effects = commit(effects, tick);
      console.log('  after commit:', JSON.stringify(effects.map((e) => `${e.effectType} stacks=${e.stacks}`)));
    }
  });
});
