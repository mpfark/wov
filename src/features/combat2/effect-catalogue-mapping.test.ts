import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ABILITY_SEED } from '@/shared/config/ability-seed';

function authored(key: string) {
  const ability = ABILITY_SEED.find((candidate) => candidate.ability_key === key);
  expect(ability, `${key} must remain authored`).toBeDefined();
  return ability!;
}

describe('Combat2 effect presentation catalogue evidence', () => {
  it('retains the documented authored effect mechanics and stance modes', () => {
    expect(authored('divine_challenge')).toMatchObject({ mechanic_key: 'mitigation_buff', activation_mode: 'instant' });
    expect(authored('battle_cry')).toMatchObject({ mechanic_key: 'mitigation_buff', activation_mode: 'stance' });
    expect(authored('holy_shield')).toMatchObject({ mechanic_key: 'reactive_holy', activation_mode: 'stance' });
    expect(authored('force_shield')).toMatchObject({ mechanic_key: 'absorb_buff', activation_mode: 'stance' });
    expect(authored('rend')).toMatchObject({ mechanic_key: 'dot_debuff', activation_mode: 'instant' });
  });

  it('retains the canonical reactive_holy to reactive_damage normalization', () => {
    const source = readFileSync('src/shared/combat2/catalog.ts', 'utf8');
    expect(source).toMatch(/reactive_holy:\s*'reactive_damage'/);
  });

  it('keeps presentation free of combat calculations and persistence calls', () => {
    const source = readFileSync('src/features/combat2/presentation.ts', 'utf8');
    expect(source).not.toMatch(/supabase|\.rpc\(|\.from\(|mitigat(?:e|ion)\s*[+*=]|damage\s*[+*=]|reservedCp/);
  });
});
