/**
 * Consolidation Group G — the remaining single-holdout mechanics must be
 * configuration-driven: the attributes they scale on live in `effect_config`
 * and every log line is authored in `combat_text`, so no coded branch needs to
 * know a class name.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getMechanicTemplate } from '@/shared/config/mechanic-templates';

const seed = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing seed ${key}`);
  return row;
};

const cfg = (key: string) => (seed(key).effect_config ?? {}) as Record<string, unknown>;
const text = (key: string) => (seed(key).combat_text ?? {}) as Record<string, unknown>;

describe('Group G consolidation', () => {
  it('barrage declares its to-hit attribute and authors every volley line', () => {
    expect(seed('barrage').mechanic_key).toBe('multi_attack');
    expect(cfg('barrage').attack_stat).toBe('dex');
    for (const key of ['cast_text', 'hit_text', 'miss_text']) {
      expect(typeof text('barrage')[key]).toBe('string');
    }
  });

  it('grand finale declares its stat, crit floor and authored wording', () => {
    expect(seed('grand_finale').mechanic_key).toBe('burst_damage');
    expect(cfg('grand_finale').stat).toBe('cha');
    expect(cfg('grand_finale').crit_threshold_floor).toBe(17);
    expect(typeof text('grand_finale').hit_text).toBe('string');
    expect(typeof text('grand_finale').miss_text).toBe('string');
  });

  it('holy shield declares magnitude/kicker attributes and retaliation wording', () => {
    expect(seed('holy_shield').mechanic_key).toBe('reactive_holy');
    expect(cfg('holy_shield').magnitude_stat).toBe('wis');
    expect(cfg('holy_shield').kicker_stat).toBe('con');
    expect(typeof text('holy_shield').retaliate_text).toBe('string');
  });

  it('shield wall keeps its block chance cap in configuration', () => {
    expect(seed('shield_wall').mechanic_key).toBe('block_buff');
    expect(cfg('shield_wall').block_chance_cap).toBe(0.95);
  });

  it('debuff and sustain holdouts author their activation lines', () => {
    expect(typeof text('sunder_armor').activate_text).toBe('string');
    expect(typeof text('natures_snare').activate_text).toBe('string');
    expect(typeof text('dissonance').activate_text).toBe('string');
    expect(typeof text('shadowstep').activate_text).toBe('string');
    expect(typeof text('transfer_health').transfer_text).toBe('string');
    expect(typeof text('inspire').activate_text).toBe('string');
    expect(typeof text('inspire').renew_text).toBe('string');
  });

  it('every Group G mechanic is still a registered template', () => {
    for (const key of [
      'multi_attack', 'burst_damage', 'reactive_holy', 'block_buff',
      'stealth_buff', 'root_debuff', 'sunder_debuff', 'hp_transfer', 'regen_buff',
    ]) {
      expect(getMechanicTemplate(key), key).not.toBeNull();
    }
  });
});
