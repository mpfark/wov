/**
 * Consolidation Group D — mitigation buffs.
 *
 * Battle Cry (percent stance) and Divine Challenge (flat timed taunt) must run
 * the single reusable `mitigation_buff` base, with mode, crit softening, shield
 * kicker, taunt framing and wording all supplied by configuration.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '../ability-seed';
import { MECHANIC_TEMPLATES, getMechanicTemplate } from '../mechanic-templates';
import { resolveStanceForAbility } from '@/features/combat/utils/stances';

const byKey = (k: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === k);
  if (!row) throw new Error(`missing seed row ${k}`);
  return row as typeof ABILITY_SEED[number] & { effect_config: Record<string, unknown> };
};

describe('mitigation_buff consolidation', () => {
  it('the legacy battle_cry mechanic is retired', () => {
    expect(MECHANIC_TEMPLATES.map(m => m.mechanicKey)).not.toContain('battle_cry');
    expect(getMechanicTemplate('battle_cry')).toBeNull();
    expect(getMechanicTemplate('mitigation_buff')).not.toBeNull();
  });

  it('both mitigation abilities share the one base', () => {
    for (const key of ['battle_cry', 'divine_challenge']) {
      expect(byKey(key).mechanic_key).toBe('mitigation_buff');
      expect((byKey(key) as { base_ability_key?: string }).base_ability_key).toBe('mitigation_buff');
    }
  });

  it('mode and identity knobs live in effect_config', () => {
    const cry = byKey('battle_cry').effect_config;
    expect(cry.mitigation_mode).toBe('percent');
    expect(cry.applies_crit_reduction).toBe(true);
    expect(cry.shield_dr_bonus).toBe(0.05);

    const challenge = byKey('divine_challenge').effect_config;
    expect(challenge.mitigation_mode).toBe('flat');
    expect(challenge.is_taunt).toBeUndefined();
    expect(challenge.applies_crit_reduction).toBeUndefined();
  });

  it('wording is authored, not coded', () => {
    for (const key of ['battle_cry', 'divine_challenge']) {
      const text = byKey(key).combat_text as Record<string, unknown>;
      expect(typeof text.mitigate_text).toBe('string');
      expect(String(text.mitigate_text)).toContain('{amount}');
    }
  });

  it('identity decides stance-ness for the shared mechanic', () => {
    expect(resolveStanceForAbility({ abilityKey: 'battle_cry', type: 'mitigation_buff' })?.key)
      .toBe('battle_cry');
    expect(resolveStanceForAbility({ abilityKey: 'divine_challenge', type: 'mitigation_buff' }))
      .toBeNull();
    // No identity: the shared mechanic alone may never resolve as a stance.
    expect(resolveStanceForAbility({ type: 'mitigation_buff' })).toBeNull();
  });
});
