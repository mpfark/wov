import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const FORWARD = readFileSync(
  'supabase/migrations/20260905140000_combat2_autoattack_effect_target_contract.sql',
  'utf8',
).replaceAll('\r\n', '\n');
const COMMIT = readFileSync(
  'supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql',
  'utf8',
).replaceAll('\r\n', '\n');

describe('autoattack effect target forward contract', () => {
  it('permits both targets only for autoattack and preserves exclusive targets otherwise', () => {
    expect(FORWARD).toMatch(/DROP CONSTRAINT node_effect_target_chk/);
    expect(FORWARD).toMatch(/kind = 'autoattack'[\s\S]*target_character_id IS NOT NULL[\s\S]*target_creature_id IS NOT NULL/);
    expect(FORWARD).toMatch(/kind <> 'autoattack'[\s\S]*target_character_id IS NOT NULL\) <> \(target_creature_id IS NOT NULL/);
  });

  it('matches the existing atomic commit payload that inserts both target columns', () => {
    expect(COMMIT).toMatch(/INSERT INTO public\.node_effect[\s\S]*target_character_id[\s\S]*target_creature_id/);
    expect(COMMIT).toMatch(/NULLIF\(rec2->>'target_character_id',''\)::uuid[\s\S]*NULLIF\(rec2->>'target_creature_id',''\)::uuid/);
  });
});
