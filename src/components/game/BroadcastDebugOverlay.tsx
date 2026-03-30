import { useState, useEffect, useRef } from 'react';
import { useBroadcastDebug, BroadcastLogEntry } from '@/hooks/useBroadcastDebug';
import { supabase } from '@/integrations/supabase/client';
import { Radio, X, Trash2, ChevronDown, ChevronUp, Activity } from 'lucide-react';

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

export default function BroadcastDebugOverlay() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const { entries, clear } = useBroadcastDebug(true);
  const latency = usePing();

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
        <span>{entries.length}</span>
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
          <span className="font-semibold text-xs">Broadcast Debug</span>
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
