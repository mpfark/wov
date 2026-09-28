import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql';
const sql = readFileSync(PATH, 'utf8').replaceAll('\r\n', '\n');
const types = readFileSync('src/integrations/supabase/types.ts', 'utf8').replaceAll('\r\n', '\n');

function tableType(name: string): string {
  const marker = `      ${name}: {`;
  const start = types.indexOf(marker);
  expect(start, `${name} exists in generated schema`).toBeGreaterThan(-1);
  const next = types.indexOf('\n      },', start + marker.length);
  return types.slice(start, next < 0 ? types.length : next);
}

describe('ENG-COMBAT-002 authoritative arrival and hostile initiation migration', () => {
  it('verifies every declared table/column dependency against generated schema types', () => {
    const manifest = sql.slice(sql.indexOf('FROM (VALUES'), sql.indexOf(') AS required(table_name,column_name)'));
    const required = [...manifest.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map(match => [match[1], match[2]] as const);
    expect(required.length).toBeGreaterThan(45);
    for (const [table, column] of required) expect(tableType(table)).toMatch(new RegExp(`\\b${column}\\??:`));
  });

  it('enters only relocated living characters at aggressive or active-engaged destinations', () => {
    expect(sql).toContain("current_setting('app.combat2_depart_authorized',true)");
    expect(sql).toContain('OLD.current_node_id IS NOT DISTINCT FROM NEW.current_node_id');
    expect(sql).toContain('NEW.hp<=0');
    expect(sql).toContain('c.is_alive AND c.is_aggressive');
    expect(sql).toContain("active_e.status='active'");
    expect(sql).toContain('active_nc.is_alive AND active_nc.engaged');
    expect(sql).toContain("'kind','no_engagement'");
  });

  it('serializes one encounter and gives every actual entry a fresh global sequence', () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||v_node::text,0))");
    expect(sql).toContain('FROM public.node_encounter WHERE node_id=v_node FOR UPDATE');
    expect(sql).toContain("v_seq:=nextval('node_fighter_entry_seq_seq')");
    expect(sql).toContain("event_type,actor_character_id,payload,request_id");
    expect(sql).toContain("txid_current()::text");
  });

  it('uses pure newest-entry tank order with a deterministic UUID tie and no party role preference', () => {
    const transform = sql.slice(sql.indexOf('-- Remove party-role priority'));
    expect(transform).toContain('representative.entry_seq DESC, representative.fighter_id DESC');
    expect(transform).toContain("position('nf.character_id = p.tank_id' IN d)>0");
    expect(transform).toContain("position('nf.character_id = p.leader_id' IN d)>0");
    expect(transform).toContain("'0 AS member_priority'");
  });

  it('derives hostility from active authored enemy-targeted catalogue rows', () => {
    expect(sql).toContain('FROM public.class_ability_assignments ca');
    expect(sql).toContain('JOIN public.abilities a ON a.id=ca.ability_id');
    expect(sql).toContain("ca.status='active' AND a.status='active'");
    expect(sql).toContain("v_target_type<>'enemy' OR v_activation='stance'");
    expect(sql).toContain("'kind','non_hostile_action'");
  });

  it('queues the exact hostile action atomically and rolls entry back on every refusal', () => {
    expect(sql).toContain("_intent_kind NOT IN ('basic_attack','ability')");
    expect(sql).toContain('public.combat_intent((v_entry->>\'encounter_id\')::uuid,_character_id,_intent_kind');
    expect(sql).toContain('_ability_key,NULL,_target_creature_id,NULL,_request_id');
    expect(sql).toContain("EXCEPTION WHEN SQLSTATE 'P0001'");
    expect(sql).toContain("to_regprocedure('public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)')");
    expect(sql).toContain('public.combat_enter_without_engagement_gate(_character_id,_request_id)');
  });

  it('delegates request replay and changed-payload conflicts to the installed intent ledger first', () => {
    const replay = sql.slice(
      sql.indexOf('-- A request that already reached the authoritative intent ledger'),
      sql.indexOf("IF _intent_kind NOT IN ('basic_attack','ability')"),
    );
    expect(replay).toContain('FROM public.node_intent i WHERE i.request_id=_request_id');
    expect(replay).toContain('public.combat_intent(v_existing.encounter_id,_character_id,_intent_kind');
    expect(replay).toContain("'entry_kind','already_entered'");
  });

  it('keeps helpers server-only and exposes only the public hostile boundary', () => {
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.combat2_arrive_after_relocation(uuid,uuid)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.combat2_arrive_after_relocation(uuid,uuid) TO service_role');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.combat2_authoritative_arrival_trigger()');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.combat2_hostile_action(uuid,text,text,uuid,uuid) TO authenticated,service_role');
    expect(sql).toContain('SET search_path=public,pg_temp');
  });
});
