/**
 * Consolidation Group D — stack appliers.
 *
 * Envenom (Assassin, on-hit poison) and Orbs of Fire (Wizard, pulsing burn) are
 * the SAME base mechanic, `stack_apply`. These checks pin the contract the
 * combat-tick heartbeat relies on: the trigger mode, the persistent effect the
 * stack writes, the scaling attributes, the linger and every line of wording
 * live in configuration — never in a per-class code branch.
 */
import { describe, it, expect } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';
import { getMechanicTemplate } from '@/shared/config/mechanic-templates';

const seed = (key: string) => {
  const row = ABILITY_SEED.find(a => a.ability_key === key);
  if (!row) throw new Error(`missing seed: ${key}`);
  return row;
};

describe('stack_apply consolidation', () => {
  it('exposes one reusable stack-applying mechanic with a max_stacks param', () => {
    const template = getMechanicTemplate('stack_apply');
    expect(template).toBeTruthy();
    expect(template?.params.map(p => p.key)).toContain('max_stacks');
    expect(template?.requiresAmount).toBe(true);
  });

  it('retires the per-class poison_buff / ignite_buff mechanics', () => {
    expect(getMechanicTemplate('poison_buff')).toBeUndefined();
    expect(getMechanicTemplate('ignite_buff')).toBeUndefined();
  });

  it('routes both Envenom and Orbs of Fire through the shared base', () => {
    for (const key of ['envenom', 'ignite']) {
      expect(seed(key).mechanic_key).toBe('stack_apply');
    }
  });

  it('carries Envenom identity purely as configuration', () => {
    const cfg = seed('envenom').effect_config as Record<string, unknown>;
    expect(cfg.trigger).toBe('on_hit');
    expect(cfg.effect_type).toBe('poison');
    expect(cfg.dot_stat).toBe('dex');
    expect(cfg.consumes_all_cp).toBe(true);
    const text = seed('envenom').combat_text as Record<string, string>;
    expect(text.activate_text).toBeTruthy();
    expect(text.proc_text).toContain('{target}');
  });

  it('carries Orbs of Fire identity purely as configuration', () => {
    const cfg = seed('ignite').effect_config as Record<string, unknown>;
    expect(cfg.trigger).toBe('pulse');
    expect(cfg.effect_type).toBe('ignite');
    expect(cfg.pulse_damage_stat).toBe('int');
    expect(cfg.dot_stat).toBe('wis');
    const text = seed('ignite').combat_text as Record<string, string>;
    expect(text.pulse_text).toContain('{damage}');
    expect(text.stack_text).toBeTruthy();
  });

  it('keeps the two appliers mutually exclusive', () => {
    const envenom = seed('envenom').effect_config as Record<string, string[]>;
    const ignite = seed('ignite').effect_config as Record<string, string[]>;
    expect(envenom.mutually_exclusive_with).toContain('ignite');
    expect(ignite.mutually_exclusive_with).toContain('envenom');
  });
});
