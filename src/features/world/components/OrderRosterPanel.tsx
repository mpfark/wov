import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

interface RosterRow {
  character_id: string;
  name: string;
  family_name: string | null;
  level: number;
  class: string;
  bond: number;
}

interface Props {
  hallClass: string;
  /** Highlight the viewing character if present in the roster. */
  selfCharacterId?: string | null;
}

export default function OrderRosterPanel({ hallClass, selfCharacterId }: Props) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      const { data, error } = await supabase.rpc('get_order_roster', { _class: hallClass as any });
      if (cancelled) return;
      if (error) { setError(error.message); setRows([]); return; }
      setRows((data || []) as RosterRow[]);
    })();
    return () => { cancelled = true; };
  }, [hallClass]);

  const title = `Order of the ${hallClass.charAt(0).toUpperCase()}${hallClass.slice(1)}`;

  return (
    <div className="mt-2 p-2 rounded border border-primary/30 bg-background/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full">
          <h3 className="font-display text-sm text-primary text-glow flex items-center gap-1.5">
            🏰 {title} <span className="text-[10px] text-muted-foreground font-normal">— roster by renown</span>
          </h3>
          <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1.5">
            {rows === null && (
              <p className="text-[11px] text-muted-foreground italic">Consulting the order registry...</p>
            )}
            {error && (
              <p className="text-[11px] text-destructive">Could not load roster: {error}</p>
            )}
            {rows && rows.length === 0 && !error && (
              <p className="text-[11px] text-muted-foreground italic">No sworn members yet — be the first to bond with this order.</p>
            )}
            {rows && rows.length > 0 && (
              <ol className="space-y-0.5">
                {rows.map((r, i) => {
                  const isSelf = selfCharacterId === r.character_id;
                  return (
                    <li
                      key={r.character_id}
                      className={`flex items-center gap-2 px-1.5 py-0.5 rounded text-xs ${isSelf ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
                    >
                      <span className="w-5 text-right text-[10px] text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className={`flex-1 truncate font-display ${isSelf ? 'text-primary text-glow' : 'text-foreground'}`}>
                        {r.name}{r.family_name ? ` ${r.family_name}` : ''}
                      </span>
                      <span className="text-[10px] text-muted-foreground">L{r.level} {r.class}</span>
                      <span className="text-[10px] text-dwarvish tabular-nums" title="Renown bond">★ {r.bond}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
