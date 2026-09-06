import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { COMBAT2_TEST_ARENA, createArenaAdminApi, type ArenaResult, type ArenaStatus } from '@/features/combat2-test-arena/admin-api';
import type { AdminUser } from '@/components/admin/users/constants';

const api = createArenaAdminApi();
const nodeLabels: Record<string,string> = Object.fromEntries(COMBAT2_TEST_ARENA.nodes.map(node=>[node.purpose,node.label]));
const resultText = (r: ArenaResult) => `${r.ok ? 'Accepted' : 'Refused'}: ${r.kind}${Object.keys(r.counts).length ? ` (${Object.entries(r.counts).map(([k,v])=>`${k}: ${v}`).join(', ')})` : ''}`;

export default function Combat2TestArenaPanel() {
  const [status,setStatus]=useState<ArenaStatus|null>(null); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const [users,setUsers]=useState<AdminUser[]>([]); const [userId,setUserId]=useState(''); const [characterId,setCharacterId]=useState('');
  const [nodeId,setNodeId]=useState(''); const [busy,setBusy]=useState<string|null>(null); const [result,setResult]=useState('');
  const [refreshedAt,setRefreshedAt]=useState<Date|null>(null); const [resetPhrase,setResetPhrase]=useState('');
  const stopRequest=useRef<string|null>(null); const resetRequest=useRef<string|null>(null); const selection=useRef(''); const mounted=useRef(true); const busyRef=useRef(false);
  const selectedUser=users.find(u=>u.id===userId); const characters=selectedUser?.characters ?? [];
  const selectedCharacter=characters.find(c=>c.id===characterId); const access=status?.access.find(a=>a.userId===userId&&a.characterId===characterId);

  const refresh=useCallback(async()=>{ setLoading(true); setError(''); const response=await api.status(); if(!mounted.current)return;
    if(response.value){setStatus(response.value);setRefreshedAt(new Date());if(!nodeId){const staging=response.value.nodes.find(n=>n.purpose==='staging');if(staging)setNodeId(staging.id);}}
    else setError(response.error??'Status refused.'); setLoading(false); },[nodeId]);

  useEffect(()=>{ mounted.current=true; refresh(); (async()=>{try{const {data:{session}}=await supabase.auth.getSession();if(!session)return;
    const response=await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users?action=list&page=1`,{headers:{Authorization:`Bearer ${session.access_token}`,apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}});
    const body=await response.json(); if(mounted.current&&response.ok&&Array.isArray(body.users))setUsers(body.users);}catch{if(mounted.current)setError('Admin user list unavailable.');}})();
    return()=>{mounted.current=false;}; },[]);
  useEffect(()=>{setCharacterId(characters[0]?.id??'');},[userId]);
  useEffect(()=>{selection.current=`${userId}:${characterId}`;setResult('');},[userId,characterId]);

  const mutate=async(name:string, run:()=>ReturnType<typeof api.grant>, stable?:React.MutableRefObject<string|null>)=>{
    if(busyRef.current)return; busyRef.current=true; const snapshot=selection.current; setBusy(name); setResult(''); const response=await run();
    if(!mounted.current||snapshot!==selection.current){busyRef.current=false;setBusy(null);return;}
    if(response.value){setResult(resultText(response.value));if(response.value.ok){if(stable)stable.current=null;await refresh();}else if(stable)stable.current=null;}
    else {setResult(response.error??'Request failed.');if(!response.uncertain&&stable)stable.current=null;} busyRef.current=false;setBusy(null);
  };
  const idFor=(ref:React.MutableRefObject<string|null>)=>ref.current??(ref.current=crypto.randomUUID());
  const activeNodeOptions=useMemo(()=>status?.nodes.filter(n=>n.active)??[],[status]);

  return <div className="p-6 overflow-auto h-full space-y-4">
    <div><h1 className="font-display text-2xl text-primary">Combat2 Test Arena</h1><p className="text-sm text-muted-foreground">Administrative controls for {COMBAT2_TEST_ARENA.key}. Server classifications are authoritative.</p></div>
    <Card><CardHeader className="flex-row items-center justify-between"><CardTitle>Arena status</CardTitle><Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className="w-4 h-4 mr-1"/>Refresh</Button></CardHeader>
      <CardContent className="text-sm space-y-2">{loading&&<p>Loading authoritative status…</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}{status&&<>
        <p><b>{status.label}</b> · {status.active?'active':'inactive'} · {status.stopped?'stopped':'running'}</p>
        <p>{status.nodeCount} nodes · {status.creatureCount} creatures · {status.testerCount} registered testers</p>
        <p>{status.activeEncounterCount} active encounters · {status.claimedEncounterCount} claims · {status.pendingIntentCount} intents · {status.pendingEventCount} events</p>
        <p>Diagnostics: {status.diagnosticHistoryExists?'present':'none'} · Reset eligible: {status.resetEligible?'yes':'no'}{status.lastOperation?` · Last: ${status.lastOperation}`:''}</p></>}
        <p className="text-xs text-muted-foreground">Last refreshed: {refreshedAt?.toLocaleTimeString()??'never'} (manual refresh only)</p></CardContent></Card>

    <Card><CardHeader><CardTitle>Tester access and relocation</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
      <div className="grid md:grid-cols-2 gap-2"><label>User<select aria-label="Test user" className="w-full border rounded bg-background p-2" value={userId} onChange={e=>setUserId(e.target.value)}><option value="">Select existing user</option>{users.map(u=><option key={u.id} value={u.id}>{u.profile?.display_name||u.id}</option>)}</select></label>
      <label>Owned character<select aria-label="Owned character" className="w-full border rounded bg-background p-2" value={characterId} onChange={e=>setCharacterId(e.target.value)} disabled={!userId}><option value="">Select owned character</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
      {selectedCharacter&&<p>Confirm binding: <b>{selectedCharacter.name}</b> belongs to the selected owner. Access: {access?.active&&!access.revoked?'active':access?.revoked?'revoked':'absent'}.</p>}
      <div className="flex gap-2"><Button size="sm" disabled={!selectedCharacter||!!busy} onClick={()=>mutate('grant',()=>api.grant(userId,characterId))}>Grant exact access</Button><Button size="sm" variant="outline" disabled={!selectedCharacter||!!busy} onClick={()=>mutate('revoke',()=>api.revoke(userId,characterId))}>Revoke exact access</Button></div>
      <div className="flex gap-2 items-end"><label className="flex-1">Registered destination<select aria-label="Arena destination" className="w-full border rounded bg-background p-2" value={nodeId} onChange={e=>setNodeId(e.target.value)}>{activeNodeOptions.map(n=><option key={n.id} value={n.id}>{nodeLabels[n.purpose]}</option>)}</select></label>
      <AlertDialog><AlertDialogTrigger asChild><Button disabled={!selectedCharacter||!access?.active||access.revoked||!nodeId||!!busy}>Relocate tester</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Relocate {selectedCharacter?.name}?</AlertDialogTitle><AlertDialogDescription>Move this actively registered tester to {nodeLabels[activeNodeOptions.find(n=>n.id===nodeId)?.purpose??'staging']} using arena authority.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={()=>mutate('relocate',()=>api.relocate(characterId,nodeId))}>Confirm relocation</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
      <p className="text-xs text-muted-foreground">Relocation uses server authority and is refused for revoked access, ownership changes, inactive destinations, live claims or active Combat2 departure.</p>
    </CardContent></Card>

    <Card><CardHeader><CardTitle>Stop test run</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>Stops arena combat processing while preserving diagnostic history. It does not reset data or change global combat, world, or scheduler state.</p><p>{status?.activeEncounterCount??0} active encounters · {(status?.pendingIntentCount??0)+(status?.pendingEventCount??0)} pending items</p>
      <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" disabled={!!busy}>Stop test run and preserve evidence</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Stop {status?.label}?</AlertDialogTitle><AlertDialogDescription>Claims and pending work will be fenced. Diagnostic evidence remains.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={()=>mutate('stop',()=>api.stop(idFor(stopRequest)),stopRequest)}>Confirm stop</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </CardContent></Card>

    <Card className="border-destructive/50"><CardHeader><CardTitle className="text-destructive flex items-center gap-2"><ShieldAlert className="w-5 h-5"/>Destructive reset</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>Deletes this arena’s diagnostic runtime history. Permanent nodes, creature definitions and access registry remain. Registered testers return to staging with maximum HP/CP/MP. XP, gold, class, equipment, inventory and ownership remain unchanged. Ordinary world data is outside scope.</p>
      <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={!status?.resetEligible||!!busy}>Reset test arena</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle><AlertTriangle className="inline w-5 h-5 mr-2"/>Destroy arena diagnostics?</AlertDialogTitle><AlertDialogDescription>Current scope: {status?.activeEncounterCount??0} active encounters, {status?.testerCount??0} registered testers, {status?.creatureCount??0} creatures. Type {COMBAT2_TEST_ARENA.resetPhrase}.</AlertDialogDescription></AlertDialogHeader><Input aria-label="Reset confirmation" value={resetPhrase} onChange={e=>setResetPhrase(e.target.value)}/><AlertDialogFooter><AlertDialogCancel onClick={()=>setResetPhrase('')}>Cancel</AlertDialogCancel><AlertDialogAction disabled={resetPhrase!==COMBAT2_TEST_ARENA.resetPhrase} onClick={()=>{setResetPhrase('');void mutate('reset',()=>api.reset(idFor(resetRequest)),resetRequest);}}>Confirm destructive reset</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </CardContent></Card>{result&&<p role="status" className="border rounded p-3 text-sm">{result}</p>}</div>;
}
