import { useState } from 'react';
import { useBroadcastDebug, BroadcastLogEntry } from '@/hooks/useBroadcastDebug';
import { Button } from '@/components/ui/button';
import { Radio, X, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export default function BroadcastDebugOverlay() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const { entries, clear } = useBroadcastDebug(true);

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
  // Shorten channel name for display
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
