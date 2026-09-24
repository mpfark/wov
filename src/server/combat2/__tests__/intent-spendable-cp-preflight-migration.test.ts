import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const file = 'supabase/migrations/20260924110000_combat2_intent_spendable_cp_preflight.sql';
const sql = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');

describe('Combat2 intent spendable-CP preflight migration', () => {
  it('keeps the installed queue authority private behind the public eight-argument contract', () => {
    expect(sql).toContain('ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)');
    expect(sql).toContain('RENAME TO combat_intent_without_spendable_cp_preflight');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('TO authenticated, service_role');
  });

  it('makes request replay payload-exact before returning the installed idempotent result', () => {
    for (const field of ['encounter_id', 'character_id', 'intent_kind', 'ability_key', 'stance_key',
      'target_creature_id', 'target_character_id']) {
      expect(sql).toContain(`v_existing.${field} IS DISTINCT FROM _${field}`);
    }
    expect(sql).toContain("'reason', 'request_id_conflict'");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('combat_intent:' || _character_id::text, 0))");
  });

  it('uses authored CP fields and active authoritative reservations without queuing on refusal', () => {
    expect(sql).toContain('COALESCE(a.cp_cost, ba.cp_cost, 0)');
    expect(sql).toContain('COALESCE(a.cp_reserve_pct, ba.cp_reserve_pct, 0)');
    expect(sql).toContain('ne.target_character_id = _character_id');
    expect(sql).toContain('AND ne.is_reservation');
    expect(sql).toContain('v_available := GREATEST(0, COALESCE(v_character.cp, 0) - v_reserved)');
    expect(sql).toContain("CASE WHEN _intent_kind = 'stance_activate'");
    expect(sql).toContain("'kind', 'insufficient_resource'");
    expect(sql).toContain("'reason', 'insufficient_cp'");
    const refusal = sql.indexOf("'reason', 'insufficient_cp'");
    const delegate = sql.lastIndexOf('RETURN public.combat_intent_without_spendable_cp_preflight(');
    expect(refusal).toBeGreaterThan(0);
    expect(delegate).toBeGreaterThan(refusal);
  });
});
