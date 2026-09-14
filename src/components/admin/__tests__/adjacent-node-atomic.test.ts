import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdjacentNodeRequestTracker, decodeAdjacentNodeResult } from '../adjacent-node-admin';

const SQL=readFileSync('supabase/migrations/20260915160000_admin_adjacent_node_creation.sql','utf8');
const PAGE=readFileSync('src/pages/AdminPage.tsx','utf8');
const NODE=readFileSync('src/components/admin/NodeEditorPanel.tsx','utf8');
const HANDLER=PAGE.slice(PAGE.indexOf('const handleAddNodeAdjacent'),PAGE.indexOf('const handleEditorSaved'));
const SAVE=NODE.slice(NODE.indexOf('const saveNode'),NODE.indexOf('const deleteNode'));

describe('atomic adjacent-node creation',()=>{
 it('uses server identity, established authority, fixed search path and closed ACLs',()=>{
  for(const text of ['caller uuid:=auth.uid()','public.is_steward_or_overlord()','SECURITY DEFINER','SET search_path=public,pg_temp','REVOKE ALL ON FUNCTION public.admin_create_adjacent_node','GRANT EXECUTE ON FUNCTION public.admin_create_adjacent_node'])expect(SQL).toContain(text);
 });
 it('isolates its ledger from browser roles and realtime',()=>{
  expect(SQL).toContain('ALTER TABLE public.admin_adjacent_node_request ENABLE ROW LEVEL SECURITY');
  expect(SQL).toContain('REVOKE ALL PRIVILEGES ON TABLE public.admin_adjacent_node_request FROM PUBLIC,anon,authenticated');
  expect(SQL).toContain('REVOKE TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'); expect(SQL).not.toContain('supabase_realtime');
 });
 it('fingerprints expected parent state and every semantic input',()=>{
  for(const field of ['parent_node_id','expected_parent_connections','direction','node_fields'])expect(SQL).toContain(`prior.${field} IS DISTINCT FROM _${field}`);
  expect(SQL).toContain("'kind','request_conflict'"); expect(SQL).toContain("jsonb_build_object('replayed',true)");
 });
 it('locks request then parent then shared placement domain',()=>{
  expect(SQL.indexOf('FOR UPDATE;')).toBeLessThan(SQL.indexOf('WHERE id=_parent_node_id FOR UPDATE'));
  expect(SQL.indexOf('WHERE id=_parent_node_id FOR UPDATE')).toBeLessThan(SQL.indexOf('pg_advisory_xact_lock'));
 });
 it('inherits region and area and derives exact adjacent coordinates and reverse direction',()=>{
  expect(SQL).toContain('parent.region_id,parent.area_id');
  expect(SQL).toContain("WHEN'NE'THEN'SW'");
  expect(SQL).toContain("parent.x::bigint+(CASE dir"); expect(SQL).toContain("parent.y::bigint+(CASE dir");
 });
 it('refuses stale, occupied, malformed and colliding state before mutation',()=>{
  for(const kind of ['parent_not_found','malformed_parent_connections','stale_parent_state','direction_occupied','coordinate_collision'])expect(SQL).toContain(`'kind','${kind}'`);
  expect(SQL.indexOf("'kind','stale_parent_state'")).toBeLessThan(SQL.indexOf('INSERT INTO public.nodes'));
 });
 it('creates one node and one exact reciprocal pair in one rollback boundary',()=>{
  const creation=SQL.slice(SQL.indexOf('IF response IS NULL THEN BEGIN'),SQL.indexOf('EXCEPTION WHEN unique_violation'));
  expect(creation.match(/INSERT INTO public\.nodes/g)).toHaveLength(1); expect(creation.match(/UPDATE public\.nodes/g)).toHaveLength(1);
  expect(creation.match(/jsonb_build_object\('node_id'/g)).toHaveLength(2); expect(creation).toContain("'hidden',false");
 });
 it('preserves unrelated parent entries and unknown properties through normalization',()=>{
  expect(SQL).toContain('parent.connections||jsonb_build_array');
  expect(SQL).toContain("c || jsonb_build_object('node_id',c->>'node_id','direction',upper(c->>'direction'))");
  expect(SQL).not.toContain("jsonb_build_object(\n        'node_id'");
 });
 it('routes the map action into the editor and the editor only through the shared adapter',()=>{
  expect(HANDLER).toContain('setAdjacentToNodeId(fromId)'); expect(HANDLER).not.toContain("supabase.from('nodes')");
  expect(SAVE).toContain('submitAdjacentNode({'); expect(SAVE).not.toContain('parentConns.push');
  expect(NODE).toContain('Create adjacent node'); expect(NODE).toContain('adjacentCreationFence.current.release(operation)');
  const existingSave=SAVE.slice(SAVE.indexOf('if (activeNodeId)'),SAVE.indexOf('} else if (adjacentToNodeId'));
  expect(existingSave).not.toContain('connections,');
 });
 it('strictly decodes results and retains one UUID only for transport retry',()=>{
  expect(decodeAdjacentNodeResult({ok:true,kind:'created',node_id:'n',parent_node_id:'p',replayed:false})).not.toBeNull();
  expect(decodeAdjacentNodeResult({ok:false,kind:'stale_parent_state'})).not.toBeNull(); expect(decodeAdjacentNodeResult({ok:true,kind:'created'})).toBeNull();
  let n=0; const tracker=createAdjacentNodeRequestTracker(()=>`r${++n}`); const first=tracker.requestIdFor('x'); expect(tracker.requestIdFor('x')).toBe(first); tracker.settle('x',true); expect(tracker.requestIdFor('x')).toBe(first); tracker.settle('x',false); expect(tracker.requestIdFor('x')).not.toBe(first); expect(tracker.requestIdFor('y')).not.toBe(first);
 });
});
