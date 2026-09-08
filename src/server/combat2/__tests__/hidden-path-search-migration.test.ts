import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL=readFileSync('supabase/migrations/20260909090000_authoritative_hidden_path_search.sql','utf8').replaceAll('\r\n','\n');
const UI=readFileSync('src/features/world/hooks/useMovementActions.ts','utf8');
describe('authoritative hidden-path search',()=>{
 it('keeps opening and request tables private, RLS-enabled and outside Realtime',()=>{
  for(const table of ['hidden_connection_opening','hidden_path_search_request']){
   expect(SQL).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
   expect(SQL).toContain(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
  }
  expect(SQL).not.toContain('ALTER PUBLICATION supabase_realtime ADD TABLE');
 });
 it('derives owner, node, cost, chance, connection and five-minute expiry server-side',()=>{
  for(const value of ['auth.uid()','owns_character','c.current_node_id','focus_cost constant integer:=5','ORDER BY random() LIMIT 1',
   "roll:=floor(random()*20)::integer+1","interval '5 minutes'",'GREATEST(hidden_connection_opening.opened_until']) expect(SQL).toContain(value);
 });
 it('charges and rolls once behind durable request idempotency',()=>{
  expect(SQL).toContain("pg_advisory_xact_lock(hashtextextended('hidden_path_search:'");
  expect(SQL).toContain("'request_id_conflict'");expect(SQL).toContain("'request_pending'");
  expect(SQL).toContain('UPDATE public.characters SET cp=cp-focus_cost');
 });
 it('returns only current-node unexpired openings and closes by server time',()=>{
  expect(SQL).toContain('o.origin_node_id=c.current_node_id');expect(SQL).toContain('o.opened_until>clock_timestamp()');
  expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.player_world_nodes()');
  expect(SQL).toContain("'has_hidden_connections',EXISTS(");
  expect(SQL).toContain("NOT COALESCE((conn->>'hidden')::boolean,false) OR EXISTS");
 });
 it('allows hidden movement only through the existing solo and party contracts while open',()=>{
  expect(SQL).toContain("pg_get_functiondef('public.combat2_depart(uuid,uuid,uuid)'");
  expect(SQL).toContain("pg_get_functiondef('public.combat2_party_depart(uuid,uuid,uuid)'");
  expect(SQL.match(/hidden_connection_is_open/g)?.length).toBeGreaterThanOrEqual(3);
 });
 it('uses one RPC, never writes focus/location, and never invokes movement from search',()=>{
  expect(UI).toContain("rpc('hidden_path_search'");
  expect(UI).not.toMatch(/from\('characters'\)[\s\S]{0,100}update\(\{\s*(?:cp|current_node_id)/);
 });
});
