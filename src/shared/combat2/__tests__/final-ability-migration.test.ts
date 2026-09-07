import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const migration = readFileSync(`${dir}/20260907200000_combat2_final_ability_closure.sql`, 'utf8');

describe('final Combat2 ability migration contract', () => {
  it('retains only Lovable ledger version of the preceding stack gate', () => {
    const names = readdirSync(dir);
    expect(names).toContain('20260907175312_a1267bef-2b48-4d6e-b932-471139504a93.sql');
    expect(names).not.toContain('20260907170000_combat2_stack_ability_support_gate.sql');
  });

  it('adds fenced ally intent authority without editing installed functions in place', () => {
    for (const clause of ['target_character_id', 'target_fighter_id', 'target_entry_seq',
      "pm.status='accepted'", 'party_id_at_entry', 'current_node_id=e.node_id', 'c.hp>0']) {
      expect(migration).toContain(clause);
    }
    expect(migration).toContain('combat_intent_without_ability_support_gate(');
    expect(migration).toContain("request_id_target_conflict");
  });

  it('backfills and commits canonical tick timing through the existing atomic proposal', () => {
    for (const field of ['activated_at_tick', 'expires_after_tick', 'interval_ticks', 'next_pulse_tick']) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("rec->''config''");
    expect(migration).toContain("''tick_origin'', e.created_at");
  });

  it('projects only authorized same-encounter accepted-party ally choices', () => {
    expect(migration).toContain('combat2_sync_without_allies');
    expect(migration).toContain('nf.encounter_id=_encounter_id');
    expect(migration).toContain("pm.status='accepted'");
    expect(migration).toContain("result->>'ok' IS DISTINCT FROM 'true'");
  });
});
