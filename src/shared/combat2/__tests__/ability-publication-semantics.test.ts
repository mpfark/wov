import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import source from '../../combat/inventory/ability-publication-source.json';
import inventory from '../../combat/inventory/active-abilities.json';
import { publishAbilities } from '../../config/publish-abilities';
import { composeAbilityRow, indexAppliedStatuses } from '../../config/compose-ability';
import { applyAssignmentOverrides } from '../../config/effective-ability';
import { getClassScaling } from '../../formulas/classes';
import { buildAbilityCatalog } from '../catalog';
import { MECHANIC_HANDLERS, resolveAmount, resolveBasicAttack, type MechanicContext } from '../mechanics';
import { TickRandom } from '../rng';
import { combat2TickTiming } from '../time';

const published = publishAbilities(source);
const catalog = buildAbilityCatalog(published.abilities, published.statuses);
const spec = (key: string) => catalog.specs.get(key)!;
function context(): MechanicContext {
  const rng = new TickRandom({ encounterId: 'semantics', candidateTick: 1 });
  vi.spyOn(rng, 'd20').mockReturnValue(15);
  vi.spyOn(rng, 'roll').mockReturnValue(3);
  return { rng, nowMs: 0, tick: 1, actor: { id: 'f', character_id: 'a', entry_seq: 1,
    class: 'ranger', name: 'A', level: 20, hp: 80, max_hp: 100,
    cp: 200, max_cp: 250, str: 10, dex: 24, con: 16, int: 20, wis: 20, cha: 20,
    equipment: [] } as any, creature: { id: 'n', creature_id: 'c', spawn_seq: 1,
    name: 'C', level: 1, ac: 0, hp: 100, max_hp: 100 } as any };
}

describe('published ability semantic contract', () => {
  it('deterministically regenerates the committed catalogue and its Edge copy', () => {
    expect(inventory.abilities).toEqual(published.abilities);
    expect(inventory.statuses).toEqual(published.statuses);
    expect(readFileSync('src/shared/combat/inventory/active-abilities.json', 'utf8'))
      .toBe(readFileSync('supabase/functions/_shared/combat2/active-abilities.json', 'utf8'));
    expect(publishAbilities(source)).toEqual(published);
    expect(catalog.rejected).toEqual([]);
  });
  it('agrees with browser composition for every assignment and all seven classes', () => {
    const statuses = indexAppliedStatuses(source.statuses as any);
    const browser = applyAssignmentOverrides(source.assignments.map(row => ({ ...row,
      ability: { ...row.ability, ...composeAbilityRow(row.ability as any, row.ability.base as any, statuses) },
    })), key => {
      const configured = source.classes.find(row => row.class_key === key);
      return configured ? { primary: configured.primary_attribute, secondary: configured.secondary_attribute } as any : getClassScaling(key) as any;
    });
    expect(browser.errors).toEqual([]);
    expect(new Set(browser.rows.map(row => row.class_key)).size).toBe(7);
    for (const row of browser.rows) {
      const record = published.abilities.find(a => a.classKey === row.class_key && a.classAbilityKey === row.class_ability_key)!;
      expect(record.amountCalc).toEqual(row.ability.amount_calc);
      expect(record.durationCalc).toEqual(row.ability.duration_calc);
      expect(record.effectConfig).toEqual(row.ability.effect_config);
      expect(record.mechanicCalcs).toEqual(row.ability.mechanic_calcs);
      expect(record.cpCost).toBe(row.ability.cp_cost);
    }
  });
  it.each(['aimed_shot', 'backstab'])('%s evaluates DEX, independent of STR', key => {
    const ctx = context();
    const amount = resolveAmount(ctx, spec(key), 'test', 4);
    expect(amount).toBe(26); // D3 + DEX7 + base3 + soft7 + level6
    ctx.actor = { ...ctx.actor, str: 40 };
    expect(resolveAmount(ctx, spec(key), 'test', 4)).toBe(amount);
    ctx.actor = { ...ctx.actor, dex: 10 };
    expect(resolveAmount(ctx, spec(key), 'test', 4)).toBe(12);
  });
  it.each(['arcane_surge', 'natures_snare', 'dissonance', 'cloak_of_shadows', 'disengage', 'shadowstep'])(
    '%s preserves authored fractional values through effect creation', key => {
      const ctx = context(), ability = spec(key);
      const value = resolveAmount(ctx, ability, 'test', null)!;
      expect(value % 1).not.toBe(0);
      const effect = MECHANIC_HANDLERS[ability.mechanic](ctx, ability).effects[0];
      expect(effect.magnitude).toBe(value);
    });
  it('retains integer settlement for HP while ratios retain .25 and 1.30', () => {
    for (const [unit, base, expected] of [['percent', .25, .25], ['multiplier', 1.30, 1.30], ['hp', 1.30, 1]] as const) {
      expect(resolveAmount(context(), { ...spec('heal'), amountCalc: { base, terms: [], unit } }, 'unit', null)).toBe(expected);
    }
  });
  it('preserves statuses, class identity, supported overrides and independent unlock/cost', () => {
    expect(spec('fireball').appliedStatus?.key).toBe('scorched');
    expect(spec('frostbolt').appliedStatus?.key).toBe('chilled');
    expect(catalog.specs.get('wizard:orbs_of_fire')).toBe(spec('ignite'));
    const changed = structuredClone(source);
    const row = changed.assignments.find(row => row.class_ability_key === 'aimed_shot')!;
    row.unlock_level = 42;
    row.overrides = { label: 'Precision', combat_text: { hit_text: 'Hit {target}' }, scaling: { primary_attribute: 'wis' } } as any;
    const record = publishAbilities(changed).abilities.find(a => a.abilityKey === 'aimed_shot')!;
    expect(record.unlockLevel).toBe(42); expect(record.cpCost).toBe(10);
    expect(record.label).toBe('Precision'); expect(record.combatText.hit_text).toBe('Hit {target}');
    expect(record.amountCalc!.terms.filter(t => t.source === 'stat').every(t => t.stat === 'wis')).toBe(true);
  });
  it('preserves activation/reservation fields for all eight stances', () => {
    const stances = published.abilities.filter(a => a.activationMode === 'stance');
    expect(stances).toHaveLength(8);
    for (const stance of stances) {
      const base = source.assignments.find(row => row.class_ability_key === stance.classAbilityKey)!.ability.base;
      expect(stance.cpCost).toBe(base.cp_cost);
      expect(stance.cpReservePct).toBe(base.cp_reserve_pct);
      expect(MECHANIC_HANDLERS[spec(stance.abilityKey).mechanic]({ ...context(), creature: undefined }, spec(stance.abilityKey)).effects
        .every(effect => effect.expires_at === null)).toBe(true);
    }
  });
  it('creates an independent Disengage offensive charge with the authored window', () => {
    const ctx = context(), ability = spec('disengage');
    const cast = MECHANIC_HANDLERS.evasion_buff(ctx, ability);
    const charge = cast.effects.find(effect => effect.kind === 'offense')!;
    expect(charge.config?.offense_mode).toBe('next_hit_mult');
    expect(charge.config?.expires_after_tick).toBe(combat2TickTiming(1, 15000).expires_after_tick);
    const effect = { ...charge, id: 'charge' } as any;
    ctx.activeEffects = [effect];
    const attack = resolveBasicAttack(ctx);
    expect(attack.consumeEffectIds).toContain('charge');
    const baseline = resolveBasicAttack({ ...ctx, activeEffects: [] });
    expect(attack.creatureDamage).toBeGreaterThan(baseline.creatureDamage!);
    vi.mocked(ctx.rng.d20).mockReturnValue(1);
    expect(resolveBasicAttack(ctx).consumeEffectIds).not.toContain('charge');
  });
  it('consumes a next-hit charge at most once across a multi-attack', () => {
    const ctx = context(); ctx.activeEffects = [{ id: 'charge', kind: 'offense', magnitude: 1.5,
      config: { offense_mode: 'next_hit_mult' } } as any];
    const result = MECHANIC_HANDLERS.multi_attack(ctx, spec('barrage'));
    expect(result.consumeEffectIds).toEqual(['charge']);
    expect(result.events.filter(e => e.meta?.nextHitMultiplier)).toHaveLength(1);
  });
  it.each(['purifying_light', 'crescendo'])('%s explicitly publishes heartbeat normalization', key => {
    const record = published.abilities.find(a => a.abilityKey === key)!;
    expect(record.authoredIntervalMs).toBe(3000);
    expect(record.intervalMs).toBe(2000);
    expect(record.runtimeTransformations).toEqual(['party_presence_interval_is_one_combat2_heartbeat']);
  });
});

it('publishes Battle Cry chance reduction separately from critical damage softening', () => {
  const ability = spec('battle_cry');
  expect(ability.config.crit_chance_reduction_pct).toBe(.10);
  expect(ability.config.crit_softening_pct).toBeUndefined();
  expect(MECHANIC_HANDLERS[ability.mechanic](context(), ability).effects[0].config?.crit_chance_reduction_pct).toBe(.10);
});
