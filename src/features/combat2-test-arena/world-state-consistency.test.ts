import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeAuthoritativeWorldState } from '@/hooks/useWorldSlumberState';
import { COMBAT2_TEST_ARENA, decodeArenaStatus } from './admin-api';

const PANEL=readFileSync('src/components/admin/Combat2TestArenaPanel.tsx','utf8');
const HOOK=readFileSync('src/hooks/useWorldSlumberState.ts','utf8');
const base={ok:true,kind:'status',arena_id:COMBAT2_TEST_ARENA.id,arena_key:COMBAT2_TEST_ARENA.key,label:'Arena',active:true,stopped:true,reset_eligible:true,
 node_count:5,creature_count:6,tester_count:1,located_tester_count:1,active_encounter_count:0,ordinary_encounter_count:0,claimed_encounter_count:0,live_claim_count:0,ordinary_live_claim_count:0,recent_ordinary_player_count:0,pending_intent_count:0,pending_event_count:0,
 diagnostic_history_exists:true,combat_mode:'maintenance',scheduler_enabled:false,cron_job_count:0,nodes:[],access:[]};
Object.assign(base,{arena_live_claim_count:0,active_presence_count:0,recording_status:'none'});

describe('admin authoritative world-state consistency',()=>{
 it.each([['awake','awake'],['asleep','asleep']] as const)('maps authoritative %s consistently on both admin surfaces',(raw,expected)=>{
  expect(decodeAuthoritativeWorldState(raw)).toBe(expected);
  expect(decodeArenaStatus({...base,world_state:raw})?.worldState).toBe(expected);
 });
 it('defaults non-authoritative or malformed singleton values to asleep',()=>{
  expect(decodeAuthoritativeWorldState(undefined)).toBe('asleep');expect(decodeAuthoritativeWorldState(true)).toBe('asleep');
  expect(decodeArenaStatus({...base,world_state:true})).toBeNull();
 });
 it('reads the same singleton used by wake/shutdown rather than recent-player activity',()=>{
  expect(HOOK).toContain("from('world_state').select('state, changed_at').eq('id', 1).maybeSingle()");
  expect(HOOK).not.toContain("rpc('world_is_awake'");
 });
 it('does not derive the world label from scheduler or recording state',()=>{
  expect(decodeArenaStatus({...base,world_state:'asleep',scheduler_enabled:true})?.worldState).toBe('asleep');
  expect(decodeArenaStatus({...base,world_state:'awake',scheduler_enabled:false})?.worldState).toBe('awake');
  expect(PANEL).toContain('world {status.worldState}');expect(PANEL).not.toMatch(/world \{recording|world \{status\.schedulerEnabled/);
 });
 it('manual refresh replaces status and operations never optimistically write world state',()=>{
  expect(PANEL).toContain('setStatus(response.value)');expect(PANEL).not.toMatch(/setStatus\([^)]*\.\.\.|setStatus\(previous/);
  expect(PANEL).not.toMatch(/setStatus\([^)]*(startEnvironment|closeEnvironment)|setStatus\([^)]*worldState/);
  expect(PANEL).toContain("else setError(response.error??'Status refused.')");
 });
});
