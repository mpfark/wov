import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATH = 'supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql';
const sql = readFileSync(PATH, 'utf8').replaceAll('\r\n', '\n');
const types = readFileSync('src/integrations/supabase/types.ts', 'utf8').replaceAll('\r\n', '\n');
const OLD_CASE = 'CASE WHEN g.party_id IS NULL THEN 0 WHEN nf.character_id = p.tank_id THEN 0 WHEN nf.character_id = p.leader_id THEN 1 ELSE 2 END AS member_priority';
const OLD_ORDER = 'representative.arrival_seq DESC, representative.group_id DESC, representative.member_priority, representative.entry_seq DESC, representative.fighter_id DESC';

function modelRewrite(outer: string, middle: string, inner: string): string {
  if (!outer.includes('node_tick_claim_without_boss_timing') || !middle.includes('node_tick_claim_without_canary_gate')) throw new Error('composition');
  if ([outer, middle].some(definition => definition.includes('tank_candidates') || definition.includes('p.tank_id') || definition.includes('p.leader_id'))) throw new Error('wrong layer');
  if (inner.split(OLD_CASE).length !== 2 || inner.split(OLD_ORDER).length !== 2) throw new Error('cardinality');
  return inner.replace(OLD_CASE, '0 AS member_priority')
    .replace(OLD_ORDER, 'representative.entry_seq DESC, representative.character_id DESC');
}

type ClaimMetadata = { owner: string; securityDefiner: boolean; volatility: string; config?: string[]; acl: string[] };
function validateMixedClaimMetadata(outer: ClaimMetadata, middle: ClaimMetadata, inner: ClaimMetadata): void {
  const common = (metadata: ClaimMetadata) => metadata.owner === 'postgres'
    && metadata.securityDefiner && metadata.volatility === 'v';
  if (!common(outer) || !common(middle) || !common(inner)
    || !outer.config?.includes('search_path=public, pg_temp')
    || !middle.config?.includes('search_path=public, pg_temp')
    || !inner.config?.includes('search_path=public')) throw new Error('metadata');
}

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
    expect(required.length).toBeGreaterThan(70);
    for (const [table, column] of required) expect(tableType(table)).toMatch(new RegExp(`\\b${column}\\??:`));
    for (const field of ['next_due_at', 'left_at', 'joined_at', 'party_id_at_entry', 'exit_request_id',
      'tank_fighter_id', 'reject_reason', 'consumed_at', 'consumed_tick', 'payload', 'updated_at']) {
      expect(manifest).toContain(`'${field}'`);
    }
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
    expect(transform).toContain('representative.entry_seq DESC, representative.character_id DESC');
    expect(transform).toContain("position('nf.character_id = p.tank_id' IN d)>0");
    expect(transform).toContain("position('nf.character_id = p.leader_id' IN d)>0");
    expect(transform).toContain("'0 AS member_priority'");
  });

  it('targets only the installed inner claim builder and preserves both composed wrappers', () => {
    const transform = sql.slice(sql.indexOf('-- Remove party-role priority'), sql.indexOf("DO $$\nDECLARE signature"));
    expect(transform).toContain("pg_get_functiondef('public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure)");
    expect(transform).toContain("pg_get_functiondef('public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure)<>middle_before");
    expect(transform).toContain("pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure)<>outer_before");
    expect(transform).toContain('p.proacl IS NOT DISTINCT FROM inner_acl');
    expect(transform).toContain('p.proconfig IS NOT DISTINCT FROM inner_config');
    expect(transform).not.toContain('REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer)');
  });

  it('models exact-one matching and rejects zero, multiple, wrong-layer and broken composition fixtures', () => {
    const outer = 'RETURN public.node_tick_claim_without_boss_timing(_node_id,_lease_ms);';
    const middle = 'source:=public.node_tick_claim_without_canary_gate(_node_id,_lease_ms);';
    const inner = `'tank_candidates' ${OLD_CASE} ORDER BY ${OLD_ORDER}`;
    expect(modelRewrite(outer, middle, inner)).toContain('representative.entry_seq DESC, representative.character_id DESC');
    expect(() => modelRewrite(outer, middle, 'tank_candidates')).toThrow('cardinality');
    expect(() => modelRewrite(outer, middle, `${inner} ${OLD_CASE} ${OLD_ORDER}`)).toThrow('cardinality');
    expect(() => modelRewrite(`${outer} tank_candidates p.tank_id`, middle, inner)).toThrow('wrong layer');
    expect(() => modelRewrite('RETURN other()', middle, inner)).toThrow('composition');
  });

  it('fails closed over the complete claim chain, fixed paths and pre-install trigger absence', () => {
    const preflight = sql.slice(0, sql.indexOf('-- Trigger-only entry implementation'));
    expect(sql).toContain("to_regprocedure('public.node_tick_claim_without_boss_timing(uuid,integer)')");
    expect(sql).toContain("to_regprocedure('public.node_tick_claim_without_canary_gate(uuid,integer)')");
    expect(sql).toContain("'search_path=public, auth, pg_temp'=ANY");
    expect(sql).toContain("to_regclass('public.node_fighter_entry_seq_seq')");
    expect(sql).toContain("t.tgname='combat2_authoritative_arrival'");
    expect(preflight.match(/owner\.rolname='postgres'/g)).toHaveLength(3);
    expect(sql).toContain("has_function_privilege('authenticated','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')");
  });

  it('models the exact installed mixed search paths and rejects drift at every layer', () => {
    const trusted = { owner: 'postgres', securityDefiner: true, volatility: 'v', acl: ['postgres=X/postgres', 'service_role=X/postgres'] };
    const outer = { ...trusted, config: ['search_path=public, pg_temp'] };
    const middle = { ...trusted, config: ['search_path=public, pg_temp'] };
    const inner = { ...trusted, config: ['search_path=public'] };
    expect(() => validateMixedClaimMetadata(outer, middle, inner)).not.toThrow();
    expect(() => validateMixedClaimMetadata(outer, middle, { ...inner, config: ['search_path=public, pg_temp'] })).toThrow('metadata');
    expect(() => validateMixedClaimMetadata({ ...outer, config: ['search_path=public'] }, middle, inner)).toThrow('metadata');
    expect(() => validateMixedClaimMetadata(outer, { ...middle, config: ['search_path=public'] }, inner)).toThrow('metadata');
    expect(() => validateMixedClaimMetadata({ ...outer, config: undefined }, middle, inner)).toThrow('metadata');
    expect(() => validateMixedClaimMetadata(outer, middle, { ...inner, config: ['search_path="$user", public'] })).toThrow('metadata');
  });

  it('asserts the same mixed paths after inner-only transformation while preserving all metadata arrays', () => {
    const transform = sql.slice(sql.indexOf('-- Remove party-role priority'), sql.indexOf("DO $$\nDECLARE signature"));
    expect(transform).toContain("p.oid='public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure");
    expect(transform).toContain("'search_path=public'=ANY");
    expect(transform.match(/'search_path=public, pg_temp'=ANY/g)).toHaveLength(2);
    for (const field of ['proowner', 'prosecdef', 'provolatile', 'proconfig', 'proacl']) expect(transform).toContain(field);
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
