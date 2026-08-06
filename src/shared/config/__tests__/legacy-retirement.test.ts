import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ABILITY_SEED } from '../ability-seed';
import { MECHANIC_TEMPLATES } from '../mechanic-templates';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/**
 * Final legacy retirement sweep. The consolidated pipeline must not contain a
 * per-class branch, and no seed row may still point at a retired mechanic key.
 */
describe('legacy retirement — mechanic keys', () => {
  const RETIRED = [
    'power_strike', 'aimed_shot', 'backstab', 'fireball', 'smite', 'cutting_words',
    'execute_attack', 'ignite_consume', 'poison_buff', 'ignite_buff',
    'battle_cry', 'damage_buff', 'crit_buff', 'disengage_buff',
    'root_debuff', 'sunder_debuff',
  ];

  it('exposes no retired mechanic templates', () => {
    for (const key of RETIRED) {
      expect(MECHANIC_TEMPLATES[key as keyof typeof MECHANIC_TEMPLATES]).toBeUndefined();
    }
  });

  it('seeds no ability on a retired mechanic key', () => {
    for (const row of ABILITY_SEED) {
      expect(RETIRED).not.toContain(row.mechanic_key);
    }
  });
});

describe('legacy retirement — no per-class branches in combat-tick', () => {
  const src = read('supabase/functions/combat-tick/index.ts');

  it('never compares a character class against a class name', () => {
    // Rewards/contract eligibility is a game feature, not ability behaviour, so
    // the assassin contract check is the one allowed class comparison.
    const offenders = src
      .split('\n')
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) =>
        /\.class\s*===\s*'(warrior|wizard|ranger|assassin|healer|bard|templar|rogue)'/.test(line))
      .filter(([, line]) => !line.includes('active_contract') && !/class === 'assassin'/.test(line));
    expect(offenders).toEqual([]);
  });

  it('resolves the T0 attack branch on consolidated mechanics only', () => {
    expect(src).not.toContain("paMech === 'power_strike'");
    expect(src).not.toContain("paMech === 'backstab'");
    expect(src).not.toContain("paMech === 'smite'");
    expect(src).toContain("paMech === 'weapon_attack'");
    expect(src).toContain("paMech === 'spell_attack'");
  });

  it('hardcodes no Backstab or Judgment flavour', () => {
    expect(src).not.toContain('vital point on');
    expect(src).not.toContain('passes divine judgment upon');
  });
});

describe('legacy retirement — authored T0 sentences', () => {
  it('gives Backstab authored hit and miss sentences', () => {
    const row = ABILITY_SEED.find(r => r.ability_key === 'backstab');
    expect(row?.mechanic_key).toBe('weapon_attack');
    const text = (row?.combat_text ?? {}) as Record<string, string>;
    expect(text.hit_text).toContain('{damage}');
    expect(text.hit_text).toContain('{target}');
    expect(text.miss_text).toContain('{target}');
  });

  it('keeps the cast-flavour fallback free of class branching', () => {
    const flavor = read('src/features/combat/utils/cast-flavor.ts');
    expect(flavor).not.toContain('SMITE_FLAVOR_BY_CLASS');
    expect(flavor).not.toContain("abilityType === 'smite'");
  });
});
