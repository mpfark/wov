import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeleportDialog, { calculateTeleportCpCost } from './TeleportDialog';
const { select }=vi.hoisted(()=>({select:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({select:()=>({eq:select})})}}));
vi.mock('@/components/ui/ServicePanelShell',()=>({ServicePanelShell:({left}:any)=><div>{left}</div>}));
const region={id:'r',name:'Region',min_level:1,max_level:10} as any;
const origin={id:'origin',name:'Origin',region_id:'r',is_teleport:true} as any;
const city={id:'city',name:'Major city',region_id:'r',is_teleport:true,is_public_teleport:true} as any;
const hall={id:'hall',name:'Class Hall',region_id:'r',is_teleport:true} as any;
const wild={id:'wild',name:'Wilderness',region_id:'r',is_teleport:false} as any;
const props={open:true,onClose:vi.fn(),currentNode:origin,currentRegion:region,regions:[region],nodes:[origin,city,hall,wild],playerCp:30,playerMaxCp:30,characterLevel:1,characterId:'character',onTeleport:vi.fn()};
beforeEach(()=>{select.mockReset();select.mockResolvedValue({data:[],error:null});props.onTeleport.mockReset();});afterEach(cleanup);
it('major cities are immediately available, Class Hall requires discovery, arbitrary nodes excluded',async()=>{
 select.mockResolvedValue({data:[{node_id:'hall'},{node_id:'wild'}],error:null});render(<TeleportDialog {...props}/>);
 await screen.findByText('Class Hall');expect(screen.getByText('Major city')).toBeInTheDocument();expect(screen.queryByText('Wilderness')).toBeNull();
 fireEvent.click(screen.getAllByRole('button',{name:/10 CP/})[0]);expect(props.onTeleport).toHaveBeenCalled();
});
it('stale discovery response cannot unlock destinations on another character',async()=>{
 let finish!:(v:any)=>void;select.mockReturnValueOnce(new Promise(r=>{finish=r;})).mockResolvedValue({data:[],error:null});
 const view=render(<TeleportDialog {...props}/>);view.rerender(<TeleportDialog {...props} characterId="other"/>);
 await act(async()=>{finish({data:[{node_id:'hall'}],error:null});});expect(screen.queryByText('Class Hall')).toBeNull();
});
it('offers explicit pending replay even with insufficient current CP; prevents new destination submissions',async()=>{
 const retry=vi.fn();render(<TeleportDialog {...props} playerCp={0} pendingTravel={{_kind:'teleport',_destination_node_id:'city'}} onRetry={retry}/>);
 const button=await screen.findByRole('button',{name:'Retry pending teleport'});expect(button).not.toBeDisabled();fireEvent.click(button);expect(retry).toHaveBeenCalledOnce();
 expect(screen.getByRole('button',{name:/10 CP/})).toBeDisabled();
});
it('discovery error retains public cities and gives useful feedback',async()=>{
 select.mockResolvedValue({data:null,error:{message:'offline'}});render(<TeleportDialog {...props}/>);await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded'));expect(screen.getByText('Major city')).toBeInTheDocument();
});
it('preserves owner-approved regional pricing rather than inventing geographical distance pricing',()=>{
 expect(calculateTeleportCpCost(region,region)).toBe(10);expect(calculateTeleportCpCost(region,{...region,id:'other',min_level:6})).toBe(20);
 expect(calculateTeleportCpCost(region,{...region,id:'other',min_level:100})).toBe(30);expect(calculateTeleportCpCost(undefined,region)).toBe(15);
});
it('offers the existing accepted-party node selection only at personal teleport level',async()=>{
 const members=[{id:'member',character_id:'peer',status:'accepted',character:{name:'Ally',current_node_id:'wild'}}] as any;
 const view=render(<TeleportDialog {...props} partyMembers={members}/>);expect(screen.queryByText('Ally')).toBeNull();
 view.rerender(<TeleportDialog {...props} characterLevel={22} partyMembers={members}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Teleport to Ally (10 CP)'}));expect(props.onTeleport).toHaveBeenCalledWith('wild',10);
});
