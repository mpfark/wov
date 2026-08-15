/**
 * `stack_apply` — stance to landed stack.
 *
 * The stance itself is reservation-backed and does not expire; the stack it
 * lands on a creature is an ordinary finite hostile periodic row with its own
 * authored lifetime. These tests pin the two identities apart, and pin the two
 * triggers (`on_hit` weapon hits vs `pulse` heartbeat) to their drivers.
 */
import { describe, it, expect } from 'vitest';
import { resolveTickPure } from '@/shared/combat/pure/resolver';
import { resolveAbilityConfig } from '@/shared/combat/c3/ability-resolve';
import type { AbilityConfigEntry } from '@/shared/combat/c3/ability-resolve';
import type { StackApplierSnapshot } from '@/shared/combat/pure/types';
import { snapshot, participant, creature } from './fixtures';

const caster = {
  level: 20,
  attrMods: { str: 2, dex: 4, con: 1, int: 5, wis: 3, cha: 2 },
  weaponDie: 8,
};

function entry(over: Partial<AbilityConfigEntry>): AbilityConfigEntry {
  return {
    abilityKey: 'envenom',
    classAbilityKey: 'envenom',
    classKey: 'assassin',
    mechanicKey: 'stack_apply',
    amountCalc: { base: 0.25, unit: 'percent', terms: [] } as any,
    durationCalc: null,
    intervalMs: null,
    mechanicCalcs: { max_stacks: { base: 3, unit: 'count', terms: [] } as any },
    effectConfig: {},
    cpCost: 50,
    damageType: 'poison',
    unlockLevel: 1,
    label: 'Envenom',
    ...over,
  } as AbilityConfigEntry;
}

describe('stack_apply — configuration resolution', () => {
  it('maps the authored on_hit trigger and the stack\'s own finite duration (Envenom)', () => {
    const cfg = resolveAbilityConfig(entry({
      effectConfig: {
        trigger: 'on_hit',
        effect_type: 'poison',
        dot_duration_ms: 25000,
        dot_stat: 'dex',
        dot_stat_mult: 1.2,
        dot_global_mult: 0.67,
      },
    }), caster);
    expect(cfg.failures).toEqual([]);
    expect(cfg.params?.stackTrigger).toBe('weapon_hit');
    expect(cfg.params?.stackEffectType).toBe('poison');
    // The stance carries no duration of its own …
    expect(cfg.durationMs).toBe(0);
    // … while the landed stack keeps the authored 25s.
    expect(cfg.params?.stackDurationMs).toBe(25000);
    expect(cfg.params?.dotPerTick).toBe(Math.floor((4 * 1.2) * 0.67));
    expect(cfg.params?.pulseDamage).toBe(0);
  });

  it('maps the authored pulse trigger, stat-scaled duration and spark damage (Orbs of Fire)', () => {
    const cfg = resolveAbilityConfig(entry({
      abilityKey: 'ignite',
      classAbilityKey: 'orbs_of_fire',
      classKey: 'wizard',
      damageType: 'fire',
      effectConfig: {
        trigger: 'pulse',
        effect_type: 'ignite',
        dot_duration_ms: 30000,
        dot_duration_stat: 'wis',
        dot_duration_per_point_ms: 1000,
        dot_duration_cap_ms: 45000,
        dot_stat: 'wis',
        dot_stat_mult: 0.7,
        dot_global_mult: 0.67,
        pulse_damage_base: 2,
        pulse_damage_stat: 'int',
      },
    }), caster);
    expect(cfg.failures).toEqual([]);
    expect(cfg.params?.stackTrigger).toBe('successful_pulse_hit');
    expect(cfg.params?.stackEffectType).toBe('ignite');
    expect(cfg.params?.stackDurationMs).toBe(30000 + 3 * 1000);
    expect(cfg.params?.pulseDamage).toBe(2 + 5);
  });

  it('caps the stat-scaled stack duration at the authored ceiling', () => {
    const cfg = resolveAbilityConfig(entry({
      effectConfig: {
        trigger: 'pulse',
        effect_type: 'ignite',
        dot_duration_ms: 30000,
        dot_duration_stat: 'wis',
        dot_duration_per_point_ms: 10000,
        dot_duration_cap_ms: 45000,
      },
    }), { ...caster, attrMods: { ...caster.attrMods, wis: 9 } });
    expect(cfg.params?.stackDurationMs).toBe(45000);
  });
});

function applier(over: Partial<StackApplierSnapshot> = {}): StackApplierSnapshot {
  return {
    abilityKey: 'envenom',
    effectType: 'poison',
    trigger: 'weapon_hit',
    chance: 1,
    dotPerTick: 4,
    durationMs: 25000,
    intervalMs: 2000,
    maxStacks: 3,
    damageType: 'poison',
    pulseDamage: 0,
    ...over,
  };
}

function withApplier(ap: StackApplierSnapshot, mode: 'live' | 'catchup' = 'live') {
  const p = participant({ id: 'c1' });
  return snapshot({
    mode,
    participants: [{ ...p, buffs: { ...p.buffs, stackAppliers: [ap] } }],
    creatures: [creature({ id: 'm1', hp: 400, maxHp: 400, ac: 1 })],
  });
}

describe('stack_apply — landed stacks', () => {
  it('lands a finite creature-side stack off a weapon hit, never a stance row', () => {
    const snap = withApplier(applier());
    const tick = resolveTickPure(snap);
    const row = tick.effectUpserts.find((e) => e.effectType === 'poison');
    expect(row).toBeDefined();
    expect(row!.targetKind).toBe('creature');
    expect(row!.targetId).toBe('m1');
    expect(row!.mechanic).toBe('dot_debuff');
    expect(row!.sourceCharacterId).toBe('c1');
    expect(row!.lifetime ?? 'timed').toBe('timed');
    expect(row!.expiresAtMs).toBe(snap.nowMs + 25000);
    expect(row!.amountPerTick).toBe(4);
    expect(row!.stacks).toBe(1);
  });

  it('fires the pulse trigger on its own heartbeat, with spark damage', () => {
    const tick = resolveTickPure(withApplier(applier({
      abilityKey: 'ignite', effectType: 'ignite', trigger: 'successful_pulse_hit',
      damageType: 'fire', pulseDamage: 7, durationMs: 33000,
    })));
    const row = tick.effectUpserts.find((e) => e.effectType === 'ignite');
    expect(row).toBeDefined();
    expect(row!.expiresAtMs).toBeGreaterThan(0);
    expect(tick.events.some((e) => e.type === 'stance_pulse')).toBe(true);
  });

  it('never fires a trigger the applier did not declare', () => {
    const onHitOnly = resolveTickPure(withApplier(applier()));
    expect(onHitOnly.events.some((e) => e.type === 'stance_pulse')).toBe(false);
  });

  it('respects the configured stack cap', () => {
    const snap = withApplier(applier({ maxStacks: 2 }));
    const tick = resolveTickPure({
      ...snap,
      effects: [{
        id: 'e1', lifetime: 'timed', targetKind: 'creature', targetId: 'm1',
        effectType: 'poison', stacks: 2, amountPerTick: 4,
        expiresAtMs: snap.nowMs + 10000, intervalMs: 2000, nextTickAtMs: snap.nowMs + 2000,
        damageType: 'poison', sourceCharacterId: 'c1', isPeriodic: true, ampPct: 0,
        mechanic: 'dot_debuff', abilityKey: 'envenom',
      }],
    });
    const row = tick.effectUpserts.find((e) => e.effectType === 'poison');
    expect(row?.stacks).toBe(2);
  });

  it('does not roll a proc whose chance is effectively zero', () => {
    const tick = resolveTickPure(withApplier(applier({ chance: 0.000001 })));
    expect(tick.effectUpserts.some((e) => e.effectType === 'poison')).toBe(false);
  });

  it('originates no stack in effects-only resolution, on either trigger', () => {
    for (const ap of [applier(), applier({ trigger: 'successful_pulse_hit', pulseDamage: 7 })]) {
      const tick = resolveTickPure(withApplier(ap, 'catchup'));
      expect(tick.effectUpserts.filter((e) => e.mechanic === 'dot_debuff')).toEqual([]);
      expect(tick.events.some((e) => e.type === 'stance_pulse')).toBe(false);
    }
  });
});
