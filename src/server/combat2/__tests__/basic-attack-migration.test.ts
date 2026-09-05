import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const SQL = readFileSync('supabase/migrations/20260905090000_combat2_continued_basic_attack.sql', 'utf8');
describe('continued basic attack migration contract (static SQL)', () => {
  it('keeps one authenticated signature and validates before superseding', () => {
    expect(SQL).toMatch(/intent_kind IN \('ability','stance_activate','stance_drop','basic_attack'\)/);
    expect(SQL).toMatch(/shape_basic_attack/);
    expect(SQL).toMatch(/owns_character/);
    expect(SQL).toMatch(/exit_request_id IS NOT NULL/);
    expect(SQL).toMatch(/node_creature_id.*spawn_seq/s);
    expect(SQL.indexOf("invalid_target")).toBeLessThan(SQL.indexOf("reject_reason='superseded'"));
    expect(SQL).toMatch(/claim_token=NULL.*intent_cutoff_seq=NULL/s);
    expect(SQL).toMatch(/GRANT EXECUTE.*TO authenticated,service_role/);
  });
});
