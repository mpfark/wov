import {describe,expect,it,vi} from 'vitest';
import {COMBAT2_TEST_ARENA} from './arena-identity';
import {checkCombat2SessionAccess,decodeSessionAccess} from './session-access';
const character='aaaaaaaa-0000-4000-8000-000000000001';
const node=COMBAT2_TEST_ARENA.nodes[0].id;
describe('Combat2 self-access adapter',()=>{
 it('accepts only the requested permanent arena and node',()=>{
  expect(decodeSessionAccess({ok:true,kind:'allowed',arena_id:COMBAT2_TEST_ARENA.id,node_id:node},node).status).toBe('allowed');
  expect(decodeSessionAccess({ok:true,kind:'allowed',arena_id:character,node_id:node},node).status).toBe('error');
  expect(decodeSessionAccess({ok:true,kind:'allowed',arena_id:COMBAT2_TEST_ARENA.id,node_id:COMBAT2_TEST_ARENA.nodes[1].id},node).status).toBe('error');
  expect(decodeSessionAccess({ok:true,kind:'allowed',arena_id:COMBAT2_TEST_ARENA.id,node_id:'bad'},node).status).toBe('error');
 });
 it('preserves only known safe refusal/error classifications',()=>{
  expect(decodeSessionAccess({ok:false,kind:'not_authorized'},node)).toEqual({status:'refused',classification:'not_authorized'});
  expect(decodeSessionAccess({ok:false,kind:'not_test_node'},node)).toEqual({status:'refused',classification:'not_test_node'});
  expect(decodeSessionAccess({ok:false,kind:'database_secret'},node)).toEqual({status:'error',classification:'malformed_response'});
 });
 it('calls the exact self-scoped RPC without a user id and redacts transport errors',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message:'private detail'}});
  expect(await checkCombat2SessionAccess(character,node,{rpc})).toEqual({status:'error',classification:'transport_error'});
  expect(rpc).toHaveBeenCalledWith('combat2_test_session_access',{_character_id:character,_node_id:node});
 });
});
