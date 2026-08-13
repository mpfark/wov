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

describe('C3b — combat handlers are thin shells', () => {
  const files = [
    'supabase/functions/combat-tick/index.ts',
    'supabase/functions/combat-catchup/index.ts',
  ];

  it('contain no simulation, no randomness and no direct mutation', () => {
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(src, file).not.toMatch(/Math\.random/);
      expect(src, file).not.toMatch(/\.update\(|\.insert\(|\.upsert\(|\.delete\(/);
      expect(src, file).not.toMatch(/rollD20|rollDamage|resolveDamage|resolveHeal/);
      // The only writer is the atomic commit, reached through the orchestration.
      expect(src, file).toContain('orchestrateCombatResolution');
      // No legacy fallback may remain, reachable or not.
      expect(src, file).not.toMatch(/combat-resolver|kill-resolver|tick-commit|tick-owner/);
    }
  });
});
