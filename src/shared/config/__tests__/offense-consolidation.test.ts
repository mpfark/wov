/**
 * Consolidation Group F — offensive self-buffs.
 *
 * Arcane Surge (damage amplification) and Eagle Eye (widened crit range) must
 * run the single reusable `offense_buff` base, with the behaviour mode and the
 * wording supplied by configuration rather than per-class mechanics.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '../ability-seed';
import { MECHANIC_TEMPLATES, getMechanicTemplate } from '../mechanic-templates';
import { resolveStanceForAbility, STANCE_DEFS } from '@/features/combat/utils/stances';

const byKey = (k: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === k);
  if (!row) throw new Error(`missing seed row ${k}`);
  return row as typeof ABILITY_SEED[number] & {
    effect_config: Record<string, unknown>;
    combat_text: Record<string, unknown>;
  };
};

describe('offense_buff consolidation', () => {
  it('the legacy per-class mechanics are retired', () => {
    const keys = MECHANIC_TEMPLATES.map(m => m.mechanicKey);
    expect(keys).not.toContain('damage_buff');
    expect(keys).not.toContain('crit_buff');
    expect(getMechanicTemplate('offense_buff')).not.toBeNull();
  });

  it('both offensive stances share the one base', () => {
    for (const key of ['arcane_surge', 'eagle_eye']) {
      expect(byKey(key).mechanic_key).toBe('offense_buff');
      expect((byKey(key) as { base_ability_key?: string }).base_ability_key).toBe('offense_buff');
    }
  });

  it('behaviour mode and wording are configuration', () => {
    expect(byKey('arcane_surge').effect_config.offense_mode).toBe('damage_mult');
    expect(byKey('eagle_eye').effect_config.offense_mode).toBe('crit_edge');
    expect(String(byKey('arcane_surge').combat_text.activate_text)).toContain('{mult}');
    expect(String(byKey('eagle_eye').combat_text.activate_text)).toContain('{crit_low}');
  });

  it('stance-ness is resolved by identity, never by the shared mechanic', () => {
    expect(resolveStanceForAbility({ abilityKey: 'eagle_eye', type: 'offense_buff' })?.key)
      .toBe('eagle_eye');
    expect(resolveStanceForAbility({ abilityKey: 'arcane_surge', type: 'offense_buff' })?.key)
      .toBe('arcane_surge');
    // No identity: a bare shared mechanic must not resolve to either stance.
    expect(resolveStanceForAbility({ type: 'offense_buff' })).toBeNull();
    // Legacy mechanic aliases still resolve for archived assignments.
    expect(resolveStanceForAbility({ type: 'crit_buff' })?.key).toBe('eagle_eye');
    expect(resolveStanceForAbility({ type: 'damage_buff' })?.key).toBe('arcane_surge');
  });

  it('both stances keep their reservation tiers', () => {
    expect(STANCE_DEFS.find(d => d.key === 'eagle_eye')?.tier).toBe(1);
    expect(STANCE_DEFS.find(d => d.key === 'arcane_surge')?.tier).toBe(2);
  });
});
