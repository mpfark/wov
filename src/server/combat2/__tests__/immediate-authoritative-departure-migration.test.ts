import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql=readFileSync('supabase/migrations/20260929100000_combat2_immediate_authoritative_departure.sql','utf8');
const settlement=readFileSync('supabase/migrations/20260923100000_authoritative_ooc_resource_settlement.sql','utf8').replaceAll('\r\n','\n');
const arenaReset=readFileSync('supabase/migrations/20260907051948_f907b2a9-78e9-4e38-a179-68f04e0cbc7d.sql','utf8').replaceAll('\r\n','\n');
const generatedTypes=readFileSync('src/integrations/supabase/types.ts','utf8').replaceAll('\r\n','\n');
const lockBody=sql.slice(sql.indexOf('locked_origin:=leader.current_node_id;'),sql.indexOf('$body$);'));

function rowColumns(table:string):Set<string>{
  const start=generatedTypes.indexOf(`      ${table}: {`);
  const row=generatedTypes.indexOf('        Row: {',start);
  const end=generatedTypes.indexOf('        }\n        Insert:',row);
  if(start<0||row<0||end<0)throw new Error(`missing generated table contract: ${table}`);
  return new Set([...generatedTypes.slice(row,end).matchAll(/^          ([a-z_][a-z0-9_]*):/gm)].map(match=>match[1]));
}

type Mover={id:string;joinedAt:number;leader?:boolean};
const lockOrder=(movers:Mover[])=>movers.map(m=>m.id).sort();
const movementOrder=(movers:Mover[])=>[...movers].sort((a,b)=>Number(!!a.leader)-Number(!!b.leader)||a.joinedAt-b.joinedAt||a.id.localeCompare(b.id));
function reversedPair(left:string[],right:string[]):boolean{
  for(let a=0;a<left.length;a++)for(let b=a+1;b<left.length;b++){
    const ri=right.indexOf(left[a]);const rj=right.indexOf(left[b]);
    if(ri>=0&&rj>=0&&ri>rj)return true;
  }
  return false;
}

describe('ENG-MOVE-001 immediate authoritative departure migration',()=>{
  it('reuses installed validation and completes present-fighter movement in one call',()=>{
    expect(sql).toContain('combat2_depart_without_immediate_transition');
    expect(sql).toContain("result->>'kind' IN('queued','already_queued')");
    expect(sql).toContain('combat2_finish_immediate_departure(_request_id)');
    expect(sql).not.toContain("VALUES(e.id,'fighter_depart_requested'");
  });
  it('performs only non-damage cleanup and preserves participation and creature-targeted effects',()=>{
    expect(sql).toContain("reject_reason='departed'");
    expect(sql).toContain('(character_id=d.character_id OR target_character_id=d.character_id)');
    expect(sql).toContain('target_character_id=d.character_id');
    expect(sql).toContain('SET present=false');
    expect(sql).toContain('combat2_refresh_tanks(e.id)');
    expect(sql).not.toMatch(/node_participation\s+(?:delete|update)/i);
    expect(sql).not.toMatch(/damage|durability|reward|regeneration/i);
  });
  it('fences claims, consumes the legacy event, and charges/moves exactly once',()=>{
    expect(sql).toContain('the immediate owner fences the captured claim below');
    expect(sql).toContain('claim_token=NULL');
    expect(sql).toContain('consumed_at=clock_timestamp(),consumed_tick=e.tick');
    expect(sql.match(/UPDATE public\.characters SET current_node_id=d\.destination_node_id,mp=mp-d\.cost/g)).toHaveLength(1);
    expect(sql).toContain("WHERE request_id=d.request_id AND status='queued'");
  });
  it('uses one ordered party owner and deprecates destination-less flee safely',()=>{
    expect(sql).toContain('ORDER BY movement_order FOR UPDATE');
    expect(sql).toContain('combat2_finish_immediate_party_departure(_request_id)');
    expect(sql).toContain("'kind','destination_required'");
    expect(sql).toContain('DROP TRIGGER IF EXISTS combat2_party_departure_member_finalized');
  });
  it('freezes movers, locks every character by UUID, then preserves follower-first and leader-last movement',()=>{
    expect(lockBody).toContain('array_agg(candidate.id ORDER BY candidate.id)');
    expect(lockBody).toContain('WHERE c.id=ANY(mover_ids) ORDER BY c.id FOR UPDATE');
    expect(lockBody).toContain("pm.status='accepted' AND pm.is_following");
    expect(lockBody).toContain('pm.party_id=p.id');
    expect(lockBody).toContain('pm.character_id=c.id');
    expect(lockBody).toContain('c.current_node_id IS DISTINCT FROM leader.current_node_id');
    expect(sql).toContain('ORDER BY leader_last,joined_at,id');
    expect(sql.indexOf('ORDER BY c.id FOR UPDATE')).toBeLessThan(sql.indexOf('Every included character row is already held'));
    expect(lockBody).not.toContain('WHERE id=_leader_character_id FOR UPDATE');
  });
  it('references generated party, membership, and character columns',()=>{
    const aliases:{alias:string;table:string}[]=[
      {alias:'pm',table:'party_members'},{alias:'c',table:'characters'},
    ];
    for(const {alias,table} of aliases){
      const schema=rowColumns(table);
      const refs=[...lockBody.matchAll(new RegExp(`\\b${alias}\\.([a-z_][a-z0-9_]*)\\b`,'g'))].map(m=>m[1]);
      expect(refs.length).toBeGreaterThan(0);
      for(const column of refs)expect(schema.has(column),`${alias}.${column} must exist on ${table}`).toBe(true);
    }
    expect(rowColumns('parties').has('leader_id')).toBe(true);
    const membership=rowColumns('party_members');
    for(const column of ['party_id','character_id','status','is_following','joined_at'])expect(membership.has(column)).toBe(true);
  });
  it('models settlement and party races without reversed character pairs while movement order remains independent',()=>{
    const fixtures:Mover[][]=[
      [{id:'0001',joinedAt:9,leader:true},{id:'0002',joinedAt:1}],
      [{id:'0002',joinedAt:9,leader:true},{id:'0001',joinedAt:1}],
      [{id:'0003',joinedAt:9,leader:true},{id:'0001',joinedAt:2},{id:'0002',joinedAt:1}],
    ];
    for(const movers of fixtures){
      const partyLocks=lockOrder(movers);const settlementLocks=lockOrder(movers);
      expect(reversedPair(partyLocks,settlementLocks)).toBe(false);
      expect(movementOrder(movers).at(-1)?.leader).toBe(true);
    }
    expect(reversedPair(lockOrder(fixtures[2]),lockOrder([fixtures[2][1],fixtures[2][0]]))).toBe(false);
    expect(movementOrder(fixtures[2]).map(m=>m.id)).not.toEqual(lockOrder(fixtures[2]));
  });
  it('models overlapping parties, opposite routes, and frozen-set revalidation fail-closed',()=>{
    const first=lockOrder([{id:'0003',joinedAt:0,leader:true},{id:'0001',joinedAt:1},{id:'0002',joinedAt:2}]);
    const second=lockOrder([{id:'0002',joinedAt:0,leader:true},{id:'0001',joinedAt:1},{id:'0004',joinedAt:2}]);
    expect(reversedPair(first,second)).toBe(false);
    const route=(origin:string,destination:string)=>[origin,destination].sort();
    expect(route('node-b','node-a')).toEqual(route('node-a','node-b'));
    const frozen=['0001','0002','0003'];
    const revalidate=(current:{id:string;living:boolean;atOrigin:boolean;following:boolean}[])=>
      frozen.every(id=>current.some(m=>m.id===id&&m.living&&m.atOrigin&&(id==='0003'||m.following)));
    const valid=frozen.map(id=>({id,living:true,atOrigin:true,following:true}));
    expect(revalidate(valid)).toBe(true);
    for(const change of [
      valid.map(m=>m.id==='0001'?{...m,living:false}:m),
      valid.map(m=>m.id==='0002'?{...m,atOrigin:false}:m),
      valid.map(m=>m.id==='0001'?{...m,following:false}:m),
      valid.filter(m=>m.id!=='0002'),
    ])expect(revalidate(change)).toBe(false);
  });
  it('leaves authoritative resource settlement byte-for-byte unchanged and UUID ordered',()=>{
    expect(createHash('sha256').update(settlement).digest('hex')).toBe('b973e4fe9cbc7b8c787c12ac6e623e65c3ffe7a5ea8937446fc58f90acbae6b9');
    expect(settlement).toContain('FOR c IN SELECT * FROM public.characters ORDER BY id FOR UPDATE LOOP');
    expect(sql).toContain("pg_get_functiondef('public.settle_out_of_combat_resources(timestamptz)'::regprocedure)");
  });
  it('prelocks origin and destination encounters by UUID before characters, matching arena reset',()=>{
    expect(sql).toContain('WHERE node_id IN (v_origin,_destination_node_id) ORDER BY id FOR UPDATE');
    expect(sql).toContain('WHERE node_id IN(leader.current_node_id,_destination_node_id) ORDER BY id FOR UPDATE');
    expect(arenaReset).toContain('WHERE test_arena_id=_arena_id ORDER BY id FOR UPDATE');
    expect(arenaReset.indexOf('ORDER BY id FOR UPDATE')).toBeLessThan(arenaReset.indexOf('UPDATE public.characters c SET'));
    const soloPatch=sql.slice(sql.indexOf('DO $solo_encounter_pair$'),sql.indexOf('$solo_encounter_pair$;',sql.indexOf('DO $solo_encounter_pair$')));
    expect(soloPatch).toContain("ORDER BY id FOR UPDATE;\\n'||needle");
  });
  it('maps referenced columns to their installed table contracts',()=>{
    expect(sql).toContain("table_name='node_encounter' AND column_name='claim_expires_at'");
    expect(sql).toContain("table_name='node_pending_event' AND column_name='consumed_at'");
    expect(sql).toContain("table_name='node_pending_event' AND column_name='consumed_tick'");
    expect(sql).toContain("table_name='node_intent' AND column_name='target_character_id'");
    expect(sql).toContain("table_name='node_effect' AND column_name='target_character_id'");
  });
});
