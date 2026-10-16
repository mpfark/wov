// LOCAL / NON-DEPLOYABLE. Complete selected bodies, namespace/clock adaptation only.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../../',import.meta.url);
const arrival='supabase/migrations/20260928100000_combat2_authoritative_arrival_hostile_initiation.sql';
const departure='supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql';
const legacy='supabase/migrations/20260827094512_37a985a4-cb14-4ce8-9a04-43f75cd26184.sql';
export const manifest=[];
export function buildMovement(){
 manifest.length=0;
 const extract=(path,name,args,returns)=>{
  const text=readFileSync(new URL(path,root),'utf8').replace(/\r\n/g,'\n');
  const expected=path===arrival?'540e2d44d853e641bc5b3f04db3067e3e459d3815f575c057b2ffb7ce4c63095':path===legacy?'c50c9fb8d5f2be3d2b1e5499fecfd4b7c6a0c6c2d26f069ab699d87e18113ab4':'11b2778c84de0fde6714a06e0d5c8da549365afe6365b669aa1f60f859677fdb';
  assert.equal(createHash('sha256').update(text).digest('hex'),expected,'pinned movement source drift');
  const start=text.search(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\('));assert(start>=0,name);
  const tail=text.slice(start),m=/\bAS\s+(\$\w*\$)/i.exec(tail);assert(m);
  const begin=start+m.index+m[0].length,end=text.indexOf(m[1],begin),body=text.slice(begin,end);
  manifest.push({path,name,line:text.slice(0,start).split('\n').length,bodySha256:createHash('sha256').update(body).digest('hex')});
  return `CREATE FUNCTION g4a6.${name}(${args}) RETURNS ${returns} LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $source$${body.replaceAll('public.','g4a6.').replace(/\bnow\(\)/g,'g4a6.test_now()')}$source$;\n`;
 };
 return extract(arrival,'combat2_arrive_after_relocation','_character_id uuid,_request_id uuid','jsonb')+
 extract(arrival,'combat2_authoritative_arrival_trigger','','trigger')+
 extract(departure,'combat2_finish_immediate_departure','_request_id uuid','jsonb')+
 extract(departure,'combat2_finish_immediate_party_departure','_request_id uuid','jsonb')+
 extract(legacy,'encounter_end_participation','_character_id uuid,_node_id uuid','jsonb')+
 extract(legacy,'characters_end_participation_on_node_change','','trigger');
}
