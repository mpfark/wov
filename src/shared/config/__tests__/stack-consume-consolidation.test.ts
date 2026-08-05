/**
 * stack-consume-consolidation.test.ts — Group D, stack finishers.
 *
 * Eviscerate (Assassin, poison stacks, weapon damage) and Conflagrate (Wizard,
 * burn stacks, spell damage) must resolve through ONE reusable `stack_consume`
 * base. Which stack is eaten, whether the weapon die is rolled, and the scaling
 * attribute are configuration; the wording comes from authored `combat_text`.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { evaluateCalc } from '@/shared/formulas/ability-calc';
import { getMechanicTemplate } from '@/shared/config/mechanic-templates';

const byKey = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing seed row: ${key}`);
  return row;
};

const EV = byKey('eviscerate');
const CO = byKey('conflagrate');

describe('stack finisher consolidation', () => {
  it('both finishers share the one stack_consume base', () => {
    for (const row of [EV, CO]) {
      expect(row.mechanic_key).toBe('stack_consume');
      expect(row.base_ability_key).toBe('stack_consume');
      expect(row.ability_type).toBe('damage');
      expect(row.activation_mode).toBe('queued');
      expect(row.target_type).toBe('enemy');
    }
    const template = getMechanicTemplate('stack_consume');
    expect(template?.requiresAmount).toBe(true);
    expect(template?.params.map(p => p.key)).toContain('per_stack_multiplier');
    expect(template?.requiresStackOp?.op).toBe('consume_all');
  });

  it('the legacy per-class mechanics are retired from the template registry', () => {
    expect(getMechanicTemplate('execute_attack')).toBeUndefined();
    expect(getMechanicTemplate('ignite_consume')).toBeUndefined();
  });

  it('stack type, damage path and scaling stat are configuration', () => {
    expect(EV.effect_config).toMatchObject({
      stack_type: 'poison', stack_noun: 'poison', weapon_based: true, stat: 'dex',
    });
    expect(CO.effect_config).toMatchObject({
      stack_type: 'ignite', stack_noun: 'burn', weapon_based: false, stat: 'int',
    });
  });

  it('only the weapon-based finisher rolls a weapon die term', () => {
    const dieTerms = (row: typeof EV) =>
      (row.amount_calc?.terms ?? []).filter((t: any) => t.source === 'weapon_die');
    expect(dieTerms(EV).length).toBe(1);
    expect(dieTerms(CO).length).toBe(0);
  });

  it('per-stack bonus scales with its own configured attribute', () => {
    const ctx = { level: 20, mods: { str: 0, dex: 4, con: 0, int: 4, wis: 0, cha: 4 } };
    const evPerStack = evaluateCalc((EV.mechanic_calcs as any).per_stack_multiplier, ctx);
    const coPerStack = evaluateCalc((CO.mechanic_calcs as any).per_stack_multiplier, ctx);
    expect(evPerStack).toBeGreaterThan(0);
    expect(coPerStack).toBeGreaterThan(0);
    const flat = { level: 20, mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };
    expect(evPerStack).toBeGreaterThan(
      evaluateCalc((EV.mechanic_calcs as any).per_stack_multiplier, flat),
    );
    expect(coPerStack).toBeGreaterThan(
      evaluateCalc((CO.mechanic_calcs as any).per_stack_multiplier, flat),
    );
  });

  it('authors identity wording with the shared placeholders', () => {
    for (const row of [EV, CO]) {
      const text = row.combat_text as Record<string, string>;
      for (const key of ['hit_text', 'hit_no_stacks_text', 'miss_text']) {
        expect(typeof text[key]).toBe('string');
        expect(text[key].length).toBeGreaterThan(0);
      }
      expect(text.hit_text).toContain('{stacks}');
      expect(text.hit_text).toContain('{damage}');
      expect(text.miss_text).toContain('{target}');
    }
    expect((EV.combat_text as any).hit_text).toContain('poison');
    expect((CO.combat_text as any).hit_text).toContain('burn');
  });
});
