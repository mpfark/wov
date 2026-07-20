import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { RefreshCw, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Character {
  id: string;
  name: string;
  level: number;
  combat_trace_enabled: boolean;
}

interface AuditRow {
  id: number;
  created_at: string;
  character_id: string;
  character_name: string | null;
  node_id: string | null;
  event_type: string | null;
  message: string;
}

const LOG_CAP = 20000;

export default function CombatAuditPanel() {
  const [chars, setChars] = useState<Character[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('');

  const loadChars = useCallback(async () => {
    const { data, error } = await supabase
      .from('characters')
      .select('id, name, level, combat_trace_enabled')
      .order('combat_trace_enabled', { ascending: false })
      .order('name', { ascending: true })
      .limit(500);
    if (error) {
      toast.error(error.message);
      return;
    }
    setChars((data ?? []) as Character[]);
  }, []);

  const loadLog = useCallback(async (cid: string | null) => {
    if (!cid) { setRows([]); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('combat_audit_log' as any)
      .select('id, created_at, character_id, character_name, node_id, event_type, message')
      .eq('character_id', cid)
      .order('id', { ascending: false })
      .limit(500);
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as unknown as AuditRow[]);
  }, []);

  const loadTotal = useCallback(async () => {
    const { count } = await supabase
      .from('combat_audit_log' as any)
      .select('id', { count: 'exact', head: true });
    setTotal(count ?? 0);
  }, []);

  useEffect(() => { void loadChars(); void loadTotal(); }, [loadChars, loadTotal]);
  useEffect(() => { void loadLog(selectedId); }, [selectedId, loadLog]);

  // Realtime updates for the selected character
  useEffect(() => {
    if (!selectedId) return;
    const ch = supabase
      .channel(`combat-audit-${selectedId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'combat_audit_log', filter: `character_id=eq.${selectedId}` },
        (payload) => {
          setRows(prev => [payload.new as AuditRow, ...prev].slice(0, 500));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selectedId]);

  const toggleTrace = async (c: Character, enabled: boolean) => {
    const { error } = await supabase.rpc('set_character_combat_trace' as any, {
      _character_id: c.id,
      _enabled: enabled,
    });
    if (error) { toast.error(error.message); return; }
    setChars(prev => prev.map(x => x.id === c.id ? { ...x, combat_trace_enabled: enabled } : x));
    toast.success(`Trace ${enabled ? 'enabled' : 'disabled'} for ${c.name}`);
  };

  const traced = useMemo(() => chars.filter(c => c.combat_trace_enabled), [chars]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return chars.slice(0, 50);
    return chars.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50);
  }, [chars, search]);

  const eventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.event_type) set.add(r.event_type);
    return Array.from(set).sort();
  }, [rows]);

  const displayRows = useMemo(() => {
    return typeFilter ? rows.filter(r => r.event_type === typeFilter) : rows;
  }, [rows, typeFilter]);

  return (
    <div className="flex h-full min-h-0">
      {/* Left: character list & search */}
      <aside className="w-72 border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="w-4 h-4" /> Traced Characters
          </div>
          <Input
            placeholder="Search characters…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-3">
          <section>
            <div className="text-[10px] uppercase text-muted-foreground mb-1 px-1">
              Traced ({traced.length})
            </div>
            {traced.length === 0 && (
              <div className="text-xs text-muted-foreground italic px-1">None traced.</div>
            )}
            {traced.map(c => (
              <CharRow
                key={c.id}
                c={c}
                selected={c.id === selectedId}
                onSelect={() => setSelectedId(c.id)}
                onToggle={(v) => toggleTrace(c, v)}
              />
            ))}
          </section>

          {search && (
            <section>
              <div className="text-[10px] uppercase text-muted-foreground mb-1 px-1">
                Search
              </div>
              {filtered.map(c => (
                <CharRow
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={() => setSelectedId(c.id)}
                  onToggle={(v) => toggleTrace(c, v)}
                />
              ))}
            </section>
          )}
        </div>
      </aside>

      {/* Right: log viewer */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="p-3 border-b border-border flex items-center gap-2">
          <div className="text-sm font-semibold flex-1">
            {selectedId
              ? chars.find(c => c.id === selectedId)?.name ?? 'Combat Audit'
              : 'Select a character to view their combat log'}
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-8 text-xs bg-background border border-border rounded px-2"
          >
            <option value="">All event types</option>
            {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { void loadLog(selectedId); void loadTotal(); }}
            disabled={!selectedId || loading}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
          {!selectedId && (
            <div className="text-muted-foreground italic">No character selected.</div>
          )}
          {selectedId && displayRows.length === 0 && !loading && (
            <div className="text-muted-foreground italic">
              No log entries yet. Combat events will appear here once the character fights.
            </div>
          )}
          {displayRows.map(r => {
            if (r.event_type === 'tick_separator') {
              return (
                <div key={r.id} className="flex items-center gap-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  <span className="flex-1 border-t border-border/40" />
                  <span>tick</span>
                  <span className="flex-1 border-t border-border/40" />
                </div>
              );
            }
            return (
              <div key={r.id} className="flex gap-2 py-0.5 border-b border-border/30">
                <span className="text-muted-foreground shrink-0 w-24">
                  {new Date(r.created_at).toLocaleTimeString(undefined, { hour12: false })}
                </span>
                <span className="text-primary/70 shrink-0 w-32 truncate" title={r.event_type ?? ''}>
                  {r.event_type ?? ''}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-words">{r.message}</span>
              </div>
            );
          })}
        </div>

        <div className="p-2 border-t border-border text-[11px] text-muted-foreground flex items-center justify-between">
          <span>{displayRows.length} shown / {rows.length} loaded (last 500)</span>
          <span>Global log: {total ?? '…'} / {LOG_CAP.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

interface CharRowProps {
  c: Character;
  selected: boolean;
  onSelect: () => void;
  onToggle: (v: boolean) => void;
}

function CharRow({ c, selected, onSelect, onToggle }: CharRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer',
        selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
      )}
      onClick={onSelect}
    >
      <span className="flex-1 truncate">
        {c.name} <span className="text-muted-foreground">L{c.level}</span>
      </span>
      <Switch
        checked={c.combat_trace_enabled}
        onCheckedChange={(v) => onToggle(!!v)}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
