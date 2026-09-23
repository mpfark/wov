import { useState, useEffect, useRef } from 'react';
import { useBroadcastDebug, BroadcastLogEntry } from '@/hooks/useBroadcastDebug';
import { supabase } from '@/integrations/supabase/client';
import { Radio, X, Trash2, ChevronDown, ChevronUp, Activity, Download, Square, Circle } from 'lucide-react';
import { buildCombat2DiagnosticExport, clearCombat2Recording, currentCombat2Recording,
  exportCombat2ServerRecording, recoverableCombat2Recording, startCombat2ServerRecording,
  stopCombat2ServerRecording } from '@/features/combat2/diagnostics';

function usePing() {
  const [latency, setLatency] = useState<number | null>(null);
  const pingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    const ch = supabase.channel('debug-ping', { config: { broadcast: { self: true } } });
    pingChannelRef.current = ch;

    ch.on('broadcast', { event: 'pong' }, (payload) => {
      const sent = payload.payload?.t as number | undefined;
      if (sent && pendingRef.current === sent) {
        setLatency(Date.now() - sent);
        pendingRef.current = null;
      }
    }).subscribe();

    const iv = setInterval(() => {
      if (!pingChannelRef.current) return;
      const t = Date.now();
      pendingRef.current = t;
      pingChannelRef.current.send({ type: 'broadcast', event: 'pong', payload: { t } });
    }, 5000);

    return () => {
      clearInterval(iv);
      if (pingChannelRef.current) supabase.removeChannel(pingChannelRef.current);
      pingChannelRef.current = null;
    };
  }, []);

  return latency;
}

function latencyColor(ms: number | null): string {
  if (ms === null) return 'text-muted-foreground';
  if (ms < 100) return 'text-green-500';
  if (ms < 250) return 'text-yellow-500';
  return 'text-destructive';
}

export interface Combat2OverlayState { status: string; characterId: string; nodeId: string | null; encounterId: string | null;
  tick: number | null; cursor: number | null; diagnostic?: string | null;
  resourceDelivery?: { status: string; lastAuthoritativeAt: number | null; source: string | null } }

export default function BroadcastDebugOverlay({ combat2 }: { combat2?: Combat2OverlayState }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const { entries, clear } = useBroadcastDebug(true);
  const latency = usePing();
  const [, refresh] = useState(0);
  const [pending, setPending] = useState<'starting'|'stopping'|'exporting'|null>(null);
  const [failure, setFailure] = useState<string|null>(null);
  // A ref, not state: repeated clicks inside one React batch must still send exactly one RPC.
  const busy = useRef(false);
  const begin=(kind:'starting'|'stopping'|'exporting')=>{ if(busy.current)return false;
    busy.current=true; setPending(kind); setFailure(null); return true; };
  const finish=()=>{ busy.current=false; setPending(null); };
  useEffect(() => { const listener=()=>refresh(v=>v+1); window.addEventListener('combat2-diagnostic-change',listener);
    return()=>window.removeEventListener('combat2-diagnostic-change',listener); },[]);
  // `currentCombat2Recording` is a pure read; a stopped or expired recording stays
  // retained in storage so its client buffer survives reload and remains exportable.
  const stored=recoverableCombat2Recording();
  const recording=currentCombat2Recording();
  const retained=stored&&!recording?stored:null;
  const exportable=recording??retained;
  const message=(error:unknown)=>error instanceof Error?error.message:'Unexpected diagnostic failure';

  const startRecording=async()=>{ if(!combat2||!begin('starting'))return;
    try{ await startCombat2ServerRecording(supabase,combat2.characterId,combat2.nodeId,combat2.encounterId); }
    catch(error){ setFailure(message(error)); } finally{ finish(); } };

  const stopRecording=async()=>{ if(!recording)return; const sessionId=recording.sessionId;
    if(!begin('stopping'))return;
    try{ await stopCombat2ServerRecording(supabase,sessionId); }
    catch(error){ setFailure(`${message(error)} — the local recording is retained and can still be exported`); }
    finally{ finish(); } };

  const exportRecording=async()=>{ if(!exportable||!begin('exporting'))return;
    const target=exportable; let diagnosticPackage; let serverFailure:string|null=null;
    try{ diagnosticPackage=await exportCombat2ServerRecording(supabase,target); }
    catch(error){ serverFailure=message(error); }
    try{
      // The client buffer is never discarded when the server export fails.
      diagnosticPackage=diagnosticPackage??buildCombat2DiagnosticExport(target);
      const blob=new Blob([JSON.stringify(diagnosticPackage,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url;
      link.download=`combat2-diagnostic-${target.sessionId}.json`; link.click(); URL.revokeObjectURL(url);
      if(serverFailure)setFailure(`Server export unavailable (${serverFailure}); exported the local client events only`);
    }catch(error){ setFailure(`${message(error)} — nothing was discarded; retry the export`); }
    finally{ finish(); } };

  const recent = entries.slice(-30);
  const inCount = entries.filter(e => e.direction === 'in').length;
  const outCount = entries.filter(e => e.direction === 'out').length;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-[9999] flex items-center gap-1.5 rounded-full bg-background/90 border border-border px-3 py-1.5 text-xs font-mono text-muted-foreground shadow-lg backdrop-blur-sm hover:text-foreground transition-colors"
      >
        <Radio className="h-3 w-3 text-primary animate-pulse" />
        <span>{recording ? 'Recording' : combat2?.status ?? entries.length}</span>
        {latency !== null && (
          <span className={`ml-1 ${latencyColor(latency)}`}>{latency}ms</span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-[9999] w-80 max-h-[50vh] flex flex-col rounded-lg border border-border bg-background/95 backdrop-blur-sm shadow-xl font-mono text-[11px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-foreground">
          <Radio className="h-3 w-3 text-primary" />
          <span className="font-semibold text-xs">Combat2 diagnostics</span>
          <span className="text-muted-foreground">
            ↑{outCount} ↓{inCount}
          </span>
          <span className={`flex items-center gap-0.5 ${latencyColor(latency)}`} title="Broadcast round-trip latency (ping)">
            <Activity className="h-3 w-3" />
            {latency !== null ? `${latency}ms` : '…'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={clear} className="p-1 hover:text-foreground text-muted-foreground" title="Clear">
            <Trash2 className="h-3 w-3" />
          </button>
          <button onClick={() => setExpanded(!expanded)} className="p-1 hover:text-foreground text-muted-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </button>
          <button onClick={() => setOpen(false)} className="p-1 hover:text-foreground text-muted-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Entries */}
      {expanded && (
        <div className="flex-1 overflow-y-auto max-h-[40vh] px-2 py-1 space-y-0.5">
          {combat2 && <section className="space-y-1 border-b border-border p-2 text-muted-foreground">
            {combat2.encounterId ? <>
              <p>Combat: <b className="text-foreground">{combat2.status}</b> · encounter tick {combat2.tick ?? '—'} · delivery cursor {combat2.cursor ?? '—'}</p>
              <p>Node {combat2.nodeId?.slice(0,8) ?? '—'} · encounter {combat2.encounterId.slice(0,8)}</p>
            </> : <>
              <p>Combat: <b className="text-foreground">No active encounter</b></p>
              <p>Resource delivery: <b className="text-foreground">{combat2.resourceDelivery?.status ?? 'unknown'}</b>
                {combat2.resourceDelivery?.lastAuthoritativeAt
                  ? ` · authoritative row ${Math.max(0, Math.floor((Date.now() - combat2.resourceDelivery.lastAuthoritativeAt) / 1000))}s ago`
                  : ' · no authoritative row observed'}</p>
              <p>Settlement: server-owned 4s cadence · delivery {combat2.resourceDelivery?.source ?? 'unobserved'}</p>
              <p>Node {combat2.nodeId?.slice(0,8) ?? '—'} · encounter —</p>
            </>}
            {combat2.diagnostic && <p role="alert">{combat2.diagnostic}</p>}
            {retained && <p>Stopped recording retained · {retained.events.length} client events · export or clear it</p>}
            {failure && <p role="alert">{failure}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {!recording ? <button disabled={pending!==null||retained!==null} onClick={()=>void startRecording()}><Circle className="mr-1 inline h-3 w-3"/>Start</button>
                : <button disabled={pending!==null} onClick={()=>void stopRecording()}><Square className="mr-1 inline h-3 w-3"/>Stop</button>}
              <button disabled={pending!==null} onClick={clearCombat2Recording}><Trash2 className="mr-1 inline h-3 w-3"/>Clear</button>
              <button disabled={pending!==null||!exportable} onClick={()=>void exportRecording()}><Download className="mr-1 inline h-3 w-3"/>Export</button>
            </div>
          </section>}
          {recent.length === 0 && (
            <p className="text-muted-foreground text-center py-4">No broadcasts yet…</p>
          )}
          {recent.map(entry => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: BroadcastLogEntry }) {
  const age = ((Date.now() - entry.timestamp) / 1000).toFixed(1);
  const isOut = entry.direction === 'out';
  const shortChannel = entry.channel.replace(/^(node-|chat-|creature-combat-|ground-loot-|party-broadcast-)/, '');

  return (
    <div className={`flex items-start gap-1.5 py-0.5 ${isOut ? 'text-primary/80' : 'text-accent-foreground/70'}`}>
      <span className="shrink-0 w-3 text-center">{isOut ? '↑' : '↓'}</span>
      <span className="truncate flex-1">
        <span className="text-muted-foreground">{shortChannel}/</span>
        {entry.event}
      </span>
      <span className="shrink-0 text-muted-foreground/60">{age}s</span>
    </div>
  );
}
