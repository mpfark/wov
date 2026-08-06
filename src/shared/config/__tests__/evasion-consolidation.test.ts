/**
 * Consolidation Group E — evasion buffs.
 *
 * Cloak of Shadows (chance-based dodge) and Disengage (certain dodge plus a
 * next-hit damage window) must run the single reusable `evasion_buff` base,
 * with the dodge certainty, the next-hit window, the buff source tag and the
 * wording all supplied by configuration.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '../ability-seed';
import { MECHANIC_TEMPLATES, getMechanicTemplate } from '../mechanic-templates';

const byKey = (k: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === k);
  if (!row) throw new Error(`missing seed row ${k}`);
  return row as typeof ABILITY_SEED[number] & { effect_config: Record<string, unknown> };
};

describe('evasion_buff consolidation', () => {
  it('the legacy disengage_buff mechanic is retired', () => {
    expect(MECHANIC_TEMPLATES.map(m => m.mechanicKey)).not.toContain('disengage_buff');
    expect(getMechanicTemplate('disengage_buff')).toBeNull();
    expect(getMechanicTemplate('evasion_buff')).not.toBeNull();
  });

  it('both dodge abilities share the one base', () => {
    for (const key of ['cloak_of_shadows', 'disengage']) {
      expect(byKey(key).mechanic_key).toBe('evasion_buff');
      expect((byKey(key) as { base_ability_key?: string }).base_ability_key).toBe('evasion_buff');
    }
  });

  it('behaviour knobs live in effect_config', () => {
    const cloak = byKey('cloak_of_shadows').effect_config;
    expect(cloak.evasion_source).toBe('cloak');
    // No configured certainty: the calc amount IS the dodge chance.
    expect(cloak.dodge_chance).toBeUndefined();
    expect(cloak.next_hit_window_ms).toBeUndefined();

    const leap = byKey('disengage').effect_config;
    expect(leap.evasion_source).toBe('disengage');
    expect(leap.dodge_chance).toBe(1.0);
    expect(leap.next_hit_window_ms).toBe(15000);
  });

  it('wording is authored, not coded', () => {
    expect(String((byKey('cloak_of_shadows').combat_text as Record<string, unknown>).activate_text))
      .toContain('{dodge_pct}');
    const leapText = String((byKey('disengage').combat_text as Record<string, unknown>).activate_text);
    expect(leapText).toContain('{seconds}');
    expect(leapText).toContain('{bonus_pct}');
  });

  it('both rows still declare amount and duration calcs the base requires', () => {
    for (const key of ['cloak_of_shadows', 'disengage']) {
      expect(byKey(key).amount_calc).toBeTruthy();
      expect(byKey(key).duration_calc).toBeTruthy();
    }
  });
});
