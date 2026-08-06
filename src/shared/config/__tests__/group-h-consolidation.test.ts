/**
 * Consolidation Group H — control debuffs.
 *
 * Nature's Snare, Dissonance and Sunder Armor must all run the ONE reusable
 * `control_debuff` base. What differs between them is configuration
 * (`effect_config.control_mode` plus scaling attributes) and authored wording —
 * never a coded mechanic key per class.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '../ability-seed';
import { getMechanicTemplate, MECHANIC_TEMPLATES } from '../mechanic-templates';

const seed = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing ability seed "${key}"`);
  return row;
};

describe('Group H: control_debuff consolidation', () => {
  it('registers control_debuff and retires the per-class control mechanics', () => {
    expect(getMechanicTemplate('control_debuff')).not.toBeNull();
    expect(getMechanicTemplate('root_debuff')).toBeNull();
    expect(getMechanicTemplate('sunder_debuff')).toBeNull();
    const keys = MECHANIC_TEMPLATES.map(m => m.mechanicKey);
    expect(keys.filter(k => k === 'control_debuff')).toHaveLength(1);
  });

  it('requires both a magnitude and a duration', () => {
    const template = getMechanicTemplate('control_debuff')!;
    expect(template.requiresAmount).toBe(true);
    expect(template.requiresDuration).toBe(true);
    expect(template.supportsInterval).toBe(false);
    // No named calcs: everything the handler needs is the amount/duration pair.
    expect(template.params).toHaveLength(0);
  });

  it.each(['natures_snare', 'dissonance', 'sunder_armor'])(
    '%s runs the shared base with a configured control mode',
    key => {
      const row = seed(key);
      expect(row.mechanic_key).toBe('control_debuff');
      expect(row.base_ability_key).toBe('control_debuff');
      const cfg = (row.effect_config ?? {}) as Record<string, unknown>;
      expect(['damage_reduction', 'ac_reduction']).toContain(cfg.control_mode);
      expect(typeof cfg.magnitude_stat).toBe('string');
      expect(typeof cfg.duration_stat).toBe('string');
      const text = (row.combat_text ?? {}) as Record<string, unknown>;
      expect(String(text.activate_text ?? '')).toContain('{target}');
    },
  );

  it('keeps class identity in configuration, not in code', () => {
    expect((seed('sunder_armor').effect_config as any).control_mode).toBe('ac_reduction');
    expect((seed('natures_snare').effect_config as any).control_mode).toBe('damage_reduction');
    expect((seed('dissonance').effect_config as any).control_mode).toBe('damage_reduction');
    // Bard cadence vs ranger woodcraft: the same base, different attributes.
    expect((seed('dissonance').effect_config as any).duration_stat).toBe('int');
    expect((seed('natures_snare').effect_config as any).duration_stat).toBe('wis');
  });
});
