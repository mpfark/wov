import {describe,expect,it,vi} from 'vitest';
import {Combat2RespawnError,createCombat2RespawnAdapter,decodeCombat2Respawn} from './respawn';

const CHARACTER='11111111-1111-4111-8111-111111111111';
const REQUEST='22222222-2222-4222-8222-222222222222';
const NODE='b0000000-0000-4000-8000-000000000001';

describe('Combat2 respawn adapter',()=>{
  it('accepts only structured authoritative success fields',()=>{
    expect(decodeCombat2Respawn({ok:true,kind:'respawned',destination_node_id:NODE,destination_name:'Hearthvale Square',restored_hp:1,gold_lost:9}))
      .toEqual({status:'respawned',classification:'respawned',destinationNodeId:NODE,destinationName:'Hearthvale Square',restoredHp:1,goldLost:9});
    expect(()=>decodeCombat2Respawn({ok:true,kind:'respawned',destination_node_id:NODE,restored_hp:1})).toThrow(Combat2RespawnError);
  });
  it('preserves safe refusal and server eligibility',()=>{
    expect(decodeCombat2Respawn({ok:false,kind:'not_ready',eligible_at:'2026-09-07T10:00:03Z'})).toMatchObject({status:'not_ready'});
    expect(decodeCombat2Respawn({ok:false,kind:'test_arena_reset_required'})).toEqual({status:'refused',classification:'test_arena_reset_required',reason:null});
  });
  it('sends only character and request identity',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:{ok:false,kind:'not_dead'},error:null});
    await createCombat2RespawnAdapter({rpc}).respawn(CHARACTER,REQUEST);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('combat2_respawn',{_character_id:CHARACTER,_request_id:REQUEST});
  });
});
