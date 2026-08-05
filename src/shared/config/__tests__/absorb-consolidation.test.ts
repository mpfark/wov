/**
 * absorb-consolidation.test.ts — Phase 6, Group C.
 *
 * Force Shield (Wizard stance, self) and Divine Aegis (Healer instant, ally)
 * must resolve through ONE reusable `absorb_buff` base. Targeting comes from
 * `target_type`, identity from authored `combat_text`, and the scaling
 * attributes are role-tagged so Class Config can substitute them.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { evaluateCalc } from '@/shared/formulas/ability-calc';
import { getMechanicTemplate } from '@/shared/config/mechanic-templates';
import { resolveStanceForAbility } from '@/features/combat/utils/stances';

const byKey = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing seed row: ${key}`);
  return row;
};

const FS = byKey('force_shield');
const DA = byKey('divine_aegis');

describe('absorb shield consolidation', () => {
  it('both shields share the one absorb_buff base', () => {
    for (const row of [FS, DA]) {
      expect(row.mechanic_key).toBe('absorb_buff');
      expect(row.base_ability_key).toBe('absorb_buff');
      expect(row.ability_type).toBe('buff');
      expect(row.effect_config).toMatchObject({ absorb_shield: true, resolved_by: 'client-cast' });
    }
    const template = getMechanicTemplate('absorb_buff');
    expect(template?.supportsDuration).toBe(true);
    expect(template?.requiresAmount).toBe(true);
  });

  it('targeting and activation are configuration, not mechanic identity', () => {
    expect(FS.target_type).toBe('self');
    expect(FS.activation_mode).toBe('stance');
    expect(DA.target_type).toBe('ally');
    expect(DA.activation_mode).toBe('instant');
  });

  it('scaling attributes are role-tagged so Class Config can substitute them', () => {
    for (const row of [FS, DA]) {
      expect(row.amount_calc?.terms[0].role).toBe('primary');
      expect(row.duration_calc?.terms[0].role).toBe('secondary');
    }
    expect(FS.amount_calc?.terms[0].stat).toBe('wis');
    expect(FS.duration_calc?.terms[0].stat).toBe('int');
    expect(DA.amount_calc?.terms[0].stat).toBe('wis');
    expect(DA.duration_calc?.terms[0].stat).toBe('con');
  });

  it('each keeps its own magnitude curve', () => {
    const ctx = { level: 20, stats: { str: 10, dex: 10, con: 18, int: 18, wis: 18, cha: 10 } } as any;
    const fsPool = evaluateCalc(FS.amount_calc!, ctx);
    const daPool = evaluateCalc(DA.amount_calc!, ctx);
    expect(daPool).toBeGreaterThan(fsPool);
    expect(evaluateCalc(DA.duration_calc!, ctx)).toBeGreaterThan(
      evaluateCalc(FS.duration_calc!, ctx),
    );
  });

  it('authors distinct self and ally wording per identity', () => {
    for (const row of [FS, DA]) {
      const text = row.combat_text as Record<string, string>;
      expect(text.self_text).toContain('{seconds}');
      expect(text.ally_text).toContain('{target}');
    }
    expect((FS.combat_text as any).self_text).toContain('Force Shield');
    expect((DA.combat_text as any).self_text).toContain('Divine Aegis');
  });

  it('a shared mechanic no longer makes the ally ward a stance', () => {
    expect(resolveStanceForAbility({ abilityKey: 'force_shield', type: 'absorb_buff' })?.key)
      .toBe('force_shield');
    expect(resolveStanceForAbility({ abilityKey: 'divine_aegis', type: 'absorb_buff' })).toBeNull();
    expect(resolveStanceForAbility({ type: 'absorb_buff', targetType: 'ally' })).toBeNull();
  });
});
