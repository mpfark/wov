import { describe,expect,it,vi } from 'vitest';
import { createPartyAwareDepartureAdapter } from './party-departure';
const C='11111111-1111-4111-8111-111111111111',N='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333',R='44444444-4444-4444-8444-444444444444';
describe('party-aware departure adapter',()=>{
 it('uses one coordinated call for a leader and preserves structured refusal',async()=>{const rpc=vi.fn().mockResolvedValue({data:{ok:false,kind:'insufficient_resource',reason:'member'},error:null});const out=await createPartyAwareDepartureAdapter({rpc},()=>true).depart(C,N,R);expect(rpc).toHaveBeenCalledExactlyOnceWith('combat2_party_depart',{_leader_character_id:C,_destination_node_id:N,_request_id:R});expect(out).toEqual({status:'refused',classification:'insufficient_resource',reason:'member'});});
 it('preserves solo departure for a character without coordinated followers',async()=>{const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'moved',origin_node_id:O,destination_node_id:N,cost:5},error:null});await createPartyAwareDepartureAdapter({rpc},()=>false).depart(C,N,R);expect(rpc).toHaveBeenCalledExactlyOnceWith('combat2_depart',{_character_id:C,_destination_node_id:N,_request_id:R});});
 it('fails malformed success closed',async()=>{const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'moved'},error:null});await expect(createPartyAwareDepartureAdapter({rpc},()=>true).depart(C,N,R)).rejects.toThrow('invalid success');});
});
