import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import NodeView from './NodeView';
import type { ComponentProps } from 'react';
import { useCreatures } from '@/features/creatures/hooks/useCreatures';
import { createCombat2EntryAdapter } from '@/features/combat2/entry';
import { routeCombat2Action } from '@/features/combat2/routeCombat2Action';
import { deriveCombat2AbilityReadiness, deriveCombat2HostileEntryReadiness } from '@/features/combat2/action-readiness';

const db = vi.hoisted(() => ({ rpc: vi.fn(), rows: new Map<string, unknown[]>() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: db.rpc,
  from: () => { let node: string; const q = { select: () => q, eq: (key: string,value: string) => { if(key==='node_id') node=value; return q; },
    then: (done: (result: unknown) => unknown) => Promise.resolve({data: db.rows.get(node) ?? []}).then(done) }; return q; },
} }));
vi.mock('@/features/world', () => ({ getNodeDisplayName: (n: {name:string}) => n.name,
  getNodeDisplayDescription: (n: {description:string}) => n.description, getKeyLabel: () => '',
  useAreaTypes: () => ({colorMap:{}}), getAreaHeaderColor: () => '' }));
vi.mock('@/features/character/components/StatusBarsStrip', () => ({ default: () => null }));
vi.mock('@/components/game/InspectPlayerDialog', () => ({ default: () => null }));
vi.mock('./LocationBackground', () => ({ default: () => null }));
vi.mock('@/features/combat2/useCombat2ResourceCapture', () => ({ useCombat2ResourceCapture: () => undefined }));

const player='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', target='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ally='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const nodeA='node-a',nodeB='node-b';
const creature = (node=nodeA,hp=10) => ({id:target,node_id:node,name:'Passive wolf',hp,max_hp:80,spawn_seq:1,is_alive:true,rarity:'regular',level:1,stats:{}});
const props = (node=nodeA): ComponentProps<typeof NodeView> => ({ node:{id:node,name:'Room',description:'',connections:[]} as any,
  region:undefined,players:[],creatures:[creature(node)] as any,character:{id:player,current_node_id:node,class:'templar',level:30,hp:30,cp:100} as any,
  eventLog:[],onAttack:vi.fn(),onTalkToNPC:vi.fn(),selectedTargetId:target,abilityTargetId:ally,rosterActionable:true });
const ability=(key:string,targetType='enemy') => ({abilityKey:key,label:key,description:'',tooltip:'',cpCost:10,type:'spell_attack',tier:0,levelRequired:1,targetType,damageType:'holy'} as any);
afterEach(cleanup);
beforeEach(()=>{db.rpc.mockReset();db.rows.clear();});

describe('ability buttons keep target domains separate',()=>{
 it.each(['judgment','fireball','smite'])('%s initiates against the selected passive creature despite an old ally selection',async key=>{
  const rpc=vi.fn().mockResolvedValue({data:{ok:true,kind:'queued',entry_kind:'entered',encounter_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},error:null});
  const adapter=createCombat2EntryAdapter({rpc}); const diagnose=vi.fn();
  const session=deriveCombat2HostileEntryReadiness({readiness:{ready:false,reason:'delivery_unavailable',message:'Waiting'},sessionStatus:'idle',
   entryStatus:'refused',entryClassification:'no_engagement',presentationStatus:'idle',encounterId:null,hasModel:false,inputLocked:false,dead:false,pendingMovement:false,rosterReady:true});
  render(<NodeView {...props()} classAbilities={[ability(key)]}
   getAbilityReadiness={(_,id)=>deriveCombat2AbilityReadiness({session,levelLocked:false,levelRequired:1,inFlight:false,targetValid:id===target,stanceActive:false,requiredCp:10,availableCp:100})}
   onUseAbility={(_,id)=>{void routeCombat2Action({enabled:true,sessionReady:false,readiness:{ready:true},ability:ability(key),availableCp:100,reservedBuffs:{},
    resolveTarget:()=>({ok:false,reason:'No encounter yet'}),resolveInitiationTarget:()=>({ok:true,target:{creatureId:id!,name:'Passive wolf'}}),
    initiateHostile:(c,k)=>adapter.engageAction!(player,c,k,player),legacy:vi.fn(),submit:vi.fn(),diagnose});}} />);
  const button=screen.getByRole('button',{name:key});expect(button).toBeEnabled();fireEvent.click(button);
  await waitFor(()=>expect(rpc).toHaveBeenCalledWith('combat2_hostile_action',expect.objectContaining({_ability_key:key,_target_creature_id:target})));
 });
 it.each([['ally',ally,ally],['ally',null,player],['self',ally,player]] as const)('%s keeps its correct target', (type,selected,expected)=>{
  const click=vi.fn();render(<NodeView {...props()} abilityTargetId={selected} classAbilities={[ability('support',type)]} onUseAbility={click}/>);
  fireEvent.click(screen.getByRole('button',{name:'support'}));expect(click).toHaveBeenCalledWith(0,expected);
 });
 it('an invalid enemy selection does not fall back to the ally',()=>{
  const readiness=vi.fn(()=>({ready:false as const,reason:'invalid_target' as const,message:'Select a valid target'}));
  render(<NodeView {...props()} selectedTargetId="missing" classAbilities={[ability('judgment')]} getAbilityReadiness={readiness} onUseAbility={vi.fn()}/>);
  expect(readiness).toHaveBeenCalledWith(0,undefined);expect(screen.getByRole('button',{name:'judgment: Select a valid target'})).toBeDisabled();
 });
});

describe('creature HP first paint',()=>{
 it('keeps names but hides cached HP until fresh roster data arrives',()=>{
  const view=render(<NodeView {...props()} rosterActionable={false}/>);
  expect(screen.getByText('Passive wolf')).toBeInTheDocument();expect(screen.queryByText('10/80')).not.toBeInTheDocument();expect(screen.getByLabelText('Loading HP for Passive wolf')).toBeInTheDocument();
  view.rerender(<NodeView {...props()} creatures={[creature(nodeA,64)] as any} rosterActionable/>);
  expect(screen.getByText('64/80')).toBeInTheDocument();expect(screen.queryByLabelText('Loading HP for Passive wolf')).not.toBeInTheDocument();
 });
 it('keeps a valid encounter override visible during roster loading and subsequent damage',()=>{
  const view=render(<NodeView {...props()} rosterActionable={false} creatureHpOverrides={{[target]:23}}/>);
  expect(screen.getByText('23/80')).toBeInTheDocument();
  view.rerender(<NodeView {...props()} creatureHpOverrides={{[target]:19}}/>);expect(screen.getByText('19/80')).toBeInTheDocument();
 });
});

function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const roster=(node:string,hp:number)=>({data:{node_id:node,realm_awake:true,respawn_pending:0,creatures:[creature(node,hp)]},error:null});
function RosterView({node}:{node:string}) {const r=useCreatures(node,undefined,undefined,undefined,player);
 return <NodeView {...props(node)} creatures={r.creatures} creaturesLoading={r.creaturesLoading} rosterActionable={r.rosterActionable}/>;}
it('late previous-node and earlier-visit responses cannot replace current HP',async()=>{
 const first=deferred<any>(),second=deferred<any>(),third=deferred<any>();db.rpc.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
 db.rows.set(nodeA,[creature(nodeA,10)]);db.rows.set(nodeB,[{...creature(nodeB,20),name:'Other wolf'}]);
 const view=render(<RosterView node={nodeA}/>);await waitFor(()=>expect(screen.getByText('Passive wolf')).toBeInTheDocument());expect(screen.queryByText('10/80')).not.toBeInTheDocument();
 view.rerender(<RosterView node={nodeB}/>);await waitFor(()=>expect(db.rpc).toHaveBeenCalledTimes(2));expect(screen.queryByText('Passive wolf')).not.toBeInTheDocument();
 view.rerender(<RosterView node={nodeA}/>);await waitFor(()=>expect(db.rpc).toHaveBeenCalledTimes(3));
 await act(async()=>third.resolve(roster(nodeA,64)));expect(screen.getByText('64/80')).toBeInTheDocument();
 await act(async()=>first.resolve(roster(nodeA,10)));expect(screen.getByText('64/80')).toBeInTheDocument();
 await act(async()=>second.resolve(roster(nodeB,20)));expect(screen.getByText('64/80')).toBeInTheDocument();expect(screen.queryByText('20/80')).not.toBeInTheDocument();
});
