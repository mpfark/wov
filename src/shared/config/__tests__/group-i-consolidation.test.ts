/**
 * Consolidation Group I — the last three single-holdout sustain/utility
 * mechanics (`hp_transfer`, `regen_buff`, `stealth_buff`) must be entirely
 * configuration-driven: no coded branch may hardcode a magnitude, a merge
 * policy, a floor or a log line for a specific class.
 */
import { describe, expect, it } from 'vitest';
import { ABILITY_SEED } from '../ability-seed';
import { getMechanicTemplate, LEGACY_AMBUSH_MULT } from '../mechanic-templates';

const seedFor = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing seed row ${key}`);
  return row;
};

const cfg = (key: string) => (seedFor(key).effect_config ?? {}) as Record<string, unknown>;
const text = (key: string) => (seedFor(key).combat_text ?? {}) as Record<string, unknown>;

describe('Group I: stealth_buff is config-driven', () => {
  it('keeps the reusable mechanic registered with amount + duration', () => {
    const template = getMechanicTemplate('stealth_buff');
    expect(template).not.toBeNull();
    expect(template!.requiresAmount).toBe(true);
    expect(template!.requiresDuration).toBe(true);
    expect(template!.params).toHaveLength(0);
  });

  it('documents Shadowstep scaling attributes and ambush consumption in config', () => {
    expect(seedFor('shadowstep').mechanic_key).toBe('stealth_buff');
    expect(cfg('shadowstep')).toMatchObject({
      ambush_stat: 'cha',
      duration_stat: 'dex',
      consumed_on_attack: true,
    });
  });

  it('authors its activation line instead of hardcoding class prose', () => {
    expect(String(text('shadowstep').activate_text)).toContain('{seconds}');
    expect(String(text('shadowstep').activate_text)).toContain('{mult}');
  });

  it('exposes one shared legacy ambush fallback for buff bags without a multiplier', () => {
    expect(LEGACY_AMBUSH_MULT).toBe(2);
  });
});

describe('Group I: regen_buff is config-driven', () => {
  it('exposes CP per tick as a named calc parameter', () => {
    const template = getMechanicTemplate('regen_buff');
    expect(template!.params.map(p => p.key)).toEqual(['cp_per_tick']);
  });

  it('carries the recast merge policy and floors in Inspire config', () => {
    expect(seedFor('inspire').mechanic_key).toBe('regen_buff');
    expect(cfg('inspire')).toMatchObject({
      refresh_policy: 'best_of',
      hp_stat: 'cha',
      cp_stat: 'cha',
      duration_stat: 'int',
      min_cp_per_tick: 1,
    });
  });

  it('authors both the first cast and the renew line', () => {
    expect(text('inspire').activate_text).toBeTruthy();
    expect(text('inspire').renew_text).toBeTruthy();
  });
});

describe('Group I: hp_transfer is config-driven', () => {
  it('keeps the reserve floor as a named calc parameter', () => {
    const template = getMechanicTemplate('hp_transfer');
    expect(template!.params.map(p => p.key)).toEqual(['reserve_hp']);
    expect(template!.requiresAmount).toBe(true);
  });

  it('documents the sacrifice/reserve attributes and the absolute floor', () => {
    expect(seedFor('transfer_health').mechanic_key).toBe('hp_transfer');
    expect(cfg('transfer_health')).toMatchObject({
      magnitude_stat: 'wis',
      reserve_stat: 'con',
      min_reserve_hp: 1,
    });
  });

  it('authors both the success line and the refusal line', () => {
    expect(String(text('transfer_health').transfer_text)).toContain('{target}');
    expect(String(text('transfer_health').no_hp_text)).toContain('{reserve}');
  });
});
