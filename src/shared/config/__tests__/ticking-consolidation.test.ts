/**
 * Consolidation Group D — ticking mechanics.
 *
 * Consecrate is no longer its own mechanic: it is the Templar identity of the
 * reusable `aura_pulse` base. Rend is the Warrior identity of the reusable
 * `dot_debuff` base. Both must express everything class-specific through
 * configuration (`effect_config`) and authored wording (`combat_text`) so a new
 * class can bind its own aura or DoT without a code change.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getMechanicTemplate, MECHANIC_TEMPLATES } from '@/shared/config/mechanic-templates';

const byKey = (key: string) => ABILITY_SEED.find(a => a.ability_key === key)!;

describe('aura_pulse consolidation', () => {
  it('registers aura_pulse and retires the class-named consecrate mechanic', () => {
    expect(getMechanicTemplate('aura_pulse')).toBeTruthy();
    expect(getMechanicTemplate('consecrate')).toBeFalsy();
    expect(MECHANIC_TEMPLATES.some(t => t.key === 'aura_pulse')).toBe(true);
  });

  it('requires amount, duration and interval on the aura base', () => {
    const t = getMechanicTemplate('aura_pulse')!;
    expect(t.requiresAmount).toBe(true);
    expect(t.requiresDuration).toBe(true);
    expect(t.requiresInterval).toBe(true);
  });

  it('drives Consecrate entirely from config + authored text', () => {
    const a = byKey('consecrate');
    expect(a.mechanic_key).toBe('aura_pulse');
    expect(a.effect_config.magnitude_stat).toBe('wis');
    expect(a.effect_config.heals_allies).toBe(true);
    expect(a.effect_config.damages_enemies).toBe(true);
    expect(a.combat_text.cast_text).toContain('{duration}');
    expect(a.combat_text.heal_text).toContain('{ally}');
    expect(a.combat_text.burn_text).toContain('{target}');
    expect(String(a.combat_text.heal_text)).toContain('{amount}');
    expect(String(a.combat_text.burn_text)).toContain('{amount}');
  });
});

describe('dot_debuff consolidation', () => {
  it('drives Rend entirely from config + authored text', () => {
    const a = byKey('rend');
    expect(a.mechanic_key).toBe('dot_debuff');
    expect(a.effect_config.effect_type).toBe('bleed');
    expect(a.effect_config.weapon_based).toBe(true);
    expect(a.effect_config.magnitude_stat).toBe('str');
    expect(a.effect_config.duration_stat).toBe('dex');
    expect(a.effect_config.max_stacks).toBe(5);
    expect(String(a.combat_text.apply_text)).toContain('{target}');
    expect(String(a.combat_text.apply_text)).toContain('{damage}');
    expect(String(a.combat_text.miss_text)).toContain('{target}');
  });

  it('keeps every ticking base on the shared amount/duration/interval contract', () => {
    for (const key of ['aura_pulse', 'dot_debuff', 'party_regen']) {
      const t = getMechanicTemplate(key)!;
      expect(t.duration).toBe(true);
      expect(t.interval).toBe(true);
    }
  });
});
