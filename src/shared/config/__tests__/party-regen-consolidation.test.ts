/**
 * party-regen-consolidation.test.ts — Phase 5, Group B.
 *
 * Purifying Light (Healer) and Crescendo (Bard) must resolve through ONE
 * reusable `party_regen` base: identical curve shape, role-tagged scaling so
 * Class Config can substitute the attributes, and distinct authored identity.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { evaluateCalc } from '@/shared/formulas/ability-calc';

const byKey = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing seed row: ${key}`);
  return row;
};

const PL = byKey('purifying_light');
const CR = byKey('crescendo');

describe('party regen consolidation', () => {
  it('both classes share the one party_regen base', () => {
    for (const row of [PL, CR]) {
      expect(row.mechanic_key).toBe('party_regen');
      expect(row.base_ability_key).toBe('party_regen');
      expect(row.ability_type).toBe('heal');
      expect(row.target_type).toBe('party');
      expect(row.cp_cost).toBe(40);
      expect(row.interval_ms).toBe(3000);
    }
  });

  it('scaling attributes are role-tagged so Class Config can substitute them', () => {
    for (const row of [PL, CR]) {
      expect(row.amount_calc?.terms[0].role).toBe('primary');
      expect(row.duration_calc?.terms[0].role).toBe('secondary');
    }
    expect(PL.amount_calc?.terms[0].stat).toBe('wis');
    expect(PL.duration_calc?.terms[0].stat).toBe('con');
    expect(CR.amount_calc?.terms[0].stat).toBe('cha');
    expect(CR.duration_calc?.terms[0].stat).toBe('int');
  });

  it('curve shape is identical — only the attribute differs', () => {
    expect(PL.amount_calc?.base).toBe(CR.amount_calc?.base);
    expect(PL.amount_calc?.floor).toBe(CR.amount_calc?.floor);
    expect(PL.duration_calc?.base).toBe(CR.duration_calc?.base);
    expect(PL.duration_calc?.cap).toBe(CR.duration_calc?.cap);

    const inputs = (mod: number) => ({
      level: 20,
      mods: { str: 0, dex: 0, con: mod, int: mod, wis: mod, cha: mod },
    });
    for (const mod of [-2, 0, 3, 7, 20]) {
      expect(evaluateCalc(PL.amount_calc!, inputs(mod)))
        .toBe(evaluateCalc(CR.amount_calc!, inputs(mod)));
      expect(evaluateCalc(PL.duration_calc!, inputs(mod)))
        .toBe(evaluateCalc(CR.duration_calc!, inputs(mod)));
    }
  });

  it('keeps distinct authored identity and no class branching data', () => {
    expect(PL.label).toBe('Purifying Light');
    expect(CR.label).toBe('Crescendo');
    for (const row of [PL, CR]) {
      const text = row.combat_text as Record<string, string>;
      expect(text.cast_text).toContain('{who}');
      expect(text.cast_text).toContain('{seconds}');
      expect(text.tick_text).toContain('{amount}');
      expect(row.effect_config.ticking_party_heal).toBe(true);
    }
    expect((PL.combat_text as Record<string, string>).tick_text)
      .not.toBe((CR.combat_text as Record<string, string>).tick_text);
  });
});
