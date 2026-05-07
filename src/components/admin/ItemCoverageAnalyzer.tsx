import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CLASS_LABELS } from '@/shared/formulas/classes';
import {
  buildCoverageReport,
  ATTRIBUTE_STATS,
  ALL_SLOTS,
} from './coverage/coverage-analyzer';
import type { CoverageCell, CoverageStatus } from './coverage/coverage-types';
import { Loader2 } from 'lucide-react';

const RARITY_OPTIONS = ['unique', 'uncommon', 'common', 'soulforged'];

function statusClass(s: CoverageStatus): string {
  if (s === 'good') return 'bg-primary/20 text-primary border-primary/40';
  if (s === 'weak') return 'bg-accent/20 text-accent-foreground border-accent/40';
  return 'bg-destructive/20 text-destructive border-destructive/40';
}

function CoverageMatrix({
  title, rows, rowLabel, matrix, bands,
}: {
  title: string;
  rows: string[];
  rowLabel: (key: string) => string;
  matrix: Record<string, Record<string, CoverageCell>>;
  bands: { key: string; label: string }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <h3 className="font-display text-sm uppercase tracking-wider text-muted-foreground mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="text-xs w-full">
          <thead>
            <tr>
              <th className="text-left p-1 text-muted-foreground font-normal"></th>
              {bands.map(b => (
                <th key={b.key} className="p-1 text-muted-foreground font-normal whitespace-nowrap">{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r}>
                <td className="text-left p-1 pr-3 text-foreground font-medium whitespace-nowrap">{rowLabel(r)}</td>
                {bands.map(b => {
                  const cell = matrix[r]?.[b.key];
                  if (!cell) return <td key={b.key} />;
                  return (
                    <td key={b.key} className="p-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className={`h-7 min-w-[2.5rem] flex items-center justify-center rounded border text-[11px] font-mono cursor-default ${statusClass(cell.status)}`}>
                            {cell.count}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <div className="text-xs font-medium mb-1">{cell.count} item(s) — {cell.status}</div>
                          {cell.itemNames.length > 0 ? (
                            <ul className="text-[11px] text-muted-foreground space-y-0.5">
                              {cell.itemNames.map((n, i) => <li key={i}>· {n}</li>)}
                            </ul>
                          ) : <div className="text-[11px] text-muted-foreground italic">No items</div>}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ItemCoverageAnalyzer() {
  const [rawItems, setRawItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [rarities, setRarities] = useState<string[]>(['unique']);
  const [includeConsumables, setIncludeConsumables] = useState(false);
  const [worldDropOnly, setWorldDropOnly] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { fetchAllRows } = await import('@/lib/supabase-paginate');
      const data = await fetchAllRows<any>((from, to) =>
        supabase
          .from('items')
          .select('id, name, rarity, level, slot, weapon_tag, hands, item_type, stats, world_drop')
          .range(from, to)
      );
      setRawItems(data);
      setLoading(false);
    })();
  }, []);

  const report = useMemo(() => buildCoverageReport(rawItems as any, {
    rarities, includeConsumables, worldDropOnly,
  }), [rawItems, rarities, includeConsumables, worldDropOnly]);

  const toggleRarity = (r: string) => {
    setRarities(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="p-4 space-y-4 max-w-[1600px] overflow-auto">
        <div>
          <h1 className="font-display text-2xl text-primary text-glow">Item Coverage</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Analyze the item pool for class, stat, and slot gaps. Read-only — recommendations only.
          </p>
        </div>

        {/* Filters */}
        <div className="rounded-lg border border-border bg-card/50 p-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Rarity:</span>
            {RARITY_OPTIONS.map(r => (
              <Badge
                key={r}
                variant={rarities.includes(r) ? 'default' : 'outline'}
                className="cursor-pointer capitalize"
                onClick={() => toggleRarity(r)}
              >
                {r}
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="world-drop" checked={worldDropOnly} onCheckedChange={setWorldDropOnly} />
            <Label htmlFor="world-drop" className="text-xs cursor-pointer">World-drop only</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="consumables" checked={includeConsumables} onCheckedChange={setIncludeConsumables} />
            <Label htmlFor="consumables" className="text-xs cursor-pointer">Include consumables</Label>
          </div>
          <span className="text-xs text-muted-foreground ml-auto">
            {rawItems.length} total items in pool
          </span>
        </div>

        {/* Class × band matrix */}
        <CoverageMatrix
          title="Class × Level Band"
          rows={report.classes}
          rowLabel={(k) => CLASS_LABELS[k] ?? k}
          matrix={report.classMatrix}
          bands={report.bands}
        />

        {/* Stat × band */}
        <CoverageMatrix
          title="Stat × Level Band (dominant stat)"
          rows={[...ATTRIBUTE_STATS]}
          rowLabel={(k) => k.toUpperCase()}
          matrix={report.statMatrix}
          bands={report.bands}
        />

        {/* Slot × band */}
        <CoverageMatrix
          title="Slot × Level Band"
          rows={ALL_SLOTS}
          rowLabel={(k) => k.replace('_', ' ')}
          matrix={report.slotMatrix}
          bands={report.bands}
        />

        {/* Gaps + recommendations */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-lg border border-destructive/40 bg-card/50 p-4">
            <h3 className="font-display text-sm uppercase tracking-wider text-destructive mb-3">
              Unique Gaps ({report.gaps.length})
            </h3>
            {report.gaps.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                {rarities.includes('unique')
                  ? 'No gaps detected for selected filters.'
                  : 'Enable the "unique" rarity filter to see gaps.'}
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-[500px] overflow-y-auto">
                {report.gaps.map((g, i) => (
                  <li key={i} className="text-xs flex items-start gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0">{g.band.label}</Badge>
                    <span className="text-foreground">
                      <span className="font-medium">{CLASS_LABELS[g.classKey]}:</span>{' '}
                      <span className="text-muted-foreground">{g.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-primary/40 bg-card/50 p-4">
            <h3 className="font-display text-sm uppercase tracking-wider text-primary mb-3">
              Suggested Next Items ({report.recommendations.length})
            </h3>
            {report.recommendations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No recommendations.</p>
            ) : (
              <ul className="space-y-1.5 max-h-[500px] overflow-y-auto">
                {report.recommendations.slice(0, 60).map(rec => (
                  <li key={rec.id} className="text-xs flex items-start gap-2">
                    <Badge variant="outline" className="text-[10px] shrink-0 font-mono">P{rec.priority}</Badge>
                    <span className="text-foreground">{rec.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(
            report.recommendations.map(r => `[P${r.priority}] ${r.text}`).join('\n')
          )}>
            Copy recommendations
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
