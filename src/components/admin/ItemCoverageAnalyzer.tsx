import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CLASS_LABELS, CLASS_LEVEL_BONUSES, CLASS_WEAPON_AFFINITY } from '@/shared/formulas/classes';
import { Loader2 } from 'lucide-react';

const RARITY_OPTIONS = ['unique', 'uncommon', 'common', 'soulforged'];
const ATTRIBUTE_STATS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ALL_SLOTS = ['weapon', 'offhand', 'head', 'chest', 'hands', 'legs', 'feet', 'neck', 'ring'];

type CoverageStatus = 'good' | 'weak' | 'missing';

interface LevelBand {
  key: string;
  label: string;
  min: number;
  max: number;
  importance: number;
}

interface CoverageCell {
  count: number;
  status: CoverageStatus;
  itemNames: string[];
}

interface RawItem {
  id: string;
  name: string;
  rarity: string;
  level: number | null;
  slot: string | null;
  weapon_tag: string | null;
  hands: number | null;
  item_type: string | null;
  stats: Record<string, number> | null;
  world_drop: boolean | null;
}

const LEVEL_BANDS: LevelBand[] = [
  { key: 'b1', label: '1-5', min: 1, max: 5, importance: 1 },
  { key: 'b2', label: '6-10', min: 6, max: 10, importance: 1 },
  { key: 'b3', label: '11-15', min: 11, max: 15, importance: 1.2 },
  { key: 'b4', label: '16-20', min: 16, max: 20, importance: 1.4 },
  { key: 'b5', label: '21-25', min: 21, max: 25, importance: 1.6 },
  { key: 'b6', label: '26-30', min: 26, max: 30, importance: 1.8 },
  { key: 'b7', label: '31-35', min: 31, max: 35, importance: 2 },
  { key: 'b8', label: '36-40', min: 36, max: 40, importance: 2.2 },
  { key: 'b9', label: '41-42', min: 41, max: 42, importance: 2.5 },
];

function bandFor(level: number | null): LevelBand | null {
  if (level == null) return null;
  return LEVEL_BANDS.find((band) => level >= band.min && level <= band.max) ?? null;
}

function dominantStat(stats: Record<string, number> | null): string | null {
  if (!stats) return null;
  let best: string | null = null;
  let bestValue = 0;

  for (const stat of ATTRIBUTE_STATS) {
    const value = Number(stats[stat] ?? 0);
    if (value > bestValue) {
      best = stat;
      bestValue = value;
    }
  }

  return best;
}

function emptyCell(): CoverageCell {
  return { count: 0, status: 'missing', itemNames: [] };
}

function itemFitsClass(classKey: string, item: RawItem): boolean {
  const itemDominantStat = dominantStat(item.stats);
  const classStats = Object.keys(CLASS_LEVEL_BONUSES[classKey] ?? {});

  return Boolean(
    (itemDominantStat && classStats.includes(itemDominantStat)) ||
    (item.weapon_tag && (CLASS_WEAPON_AFFINITY[classKey] ?? []).includes(item.weapon_tag))
  );
}

function reportStatus(count: number, uniqueOnly: boolean): CoverageStatus {
  if (uniqueOnly) {
    if (count === 0) return 'missing';
    if (count === 1) return 'weak';
    return 'good';
  }

  if (count === 0) return 'missing';
  if (count < 3) return 'weak';
  return 'good';
}

function buildCoverageReport(
  rawItems: RawItem[],
  opts: { rarities: string[]; includeConsumables: boolean; worldDropOnly: boolean }
) {
  const uniqueOnly = opts.rarities.length === 1 && opts.rarities[0] === 'unique';
  const classes = Object.keys(CLASS_LABELS);
  const classMatrix: Record<string, Record<string, CoverageCell>> = {};
  const statMatrix: Record<string, Record<string, CoverageCell>> = {};
  const slotMatrix: Record<string, Record<string, CoverageCell>> = {};

  for (const classKey of classes) {
    classMatrix[classKey] = {};
    for (const band of LEVEL_BANDS) classMatrix[classKey][band.key] = emptyCell();
  }
  for (const stat of ATTRIBUTE_STATS) {
    statMatrix[stat] = {};
    for (const band of LEVEL_BANDS) statMatrix[stat][band.key] = emptyCell();
  }
  for (const slot of ALL_SLOTS) {
    slotMatrix[slot] = {};
    for (const band of LEVEL_BANDS) slotMatrix[slot][band.key] = emptyCell();
  }

  const filteredItems = rawItems.filter((item) => {
    if (opts.rarities.length && !opts.rarities.includes(item.rarity)) return false;
    if (opts.worldDropOnly && item.world_drop === false) return false;
    if (!opts.includeConsumables && item.item_type === 'consumable') return false;
    return true;
  });

  for (const item of filteredItems) {
    const band = bandFor(item.level);
    if (!band) continue;

    for (const classKey of classes) {
      if (!itemFitsClass(classKey, item)) continue;
      const cell = classMatrix[classKey][band.key];
      cell.count += 1;
      if (cell.itemNames.length < 10) cell.itemNames.push(item.name);
    }

    const itemDominantStat = dominantStat(item.stats);
    if (itemDominantStat && statMatrix[itemDominantStat]) {
      const cell = statMatrix[itemDominantStat][band.key];
      cell.count += 1;
      if (cell.itemNames.length < 10) cell.itemNames.push(item.name);
    }

    if (item.slot && slotMatrix[item.slot]) {
      const cell = slotMatrix[item.slot][band.key];
      cell.count += 1;
      if (cell.itemNames.length < 10) cell.itemNames.push(item.name);
    }
  }

  for (const classKey of classes) {
    for (const band of LEVEL_BANDS) classMatrix[classKey][band.key].status = reportStatus(classMatrix[classKey][band.key].count, uniqueOnly);
  }
  for (const stat of ATTRIBUTE_STATS) {
    for (const band of LEVEL_BANDS) statMatrix[stat][band.key].status = reportStatus(statMatrix[stat][band.key].count, uniqueOnly);
  }
  for (const slot of ALL_SLOTS) {
    for (const band of LEVEL_BANDS) slotMatrix[slot][band.key].status = reportStatus(slotMatrix[slot][band.key].count, uniqueOnly);
  }

  const gaps: { classKey: string; band: LevelBand; reason: string }[] = [];
  const recommendations: { id: string; priority: number; text: string }[] = [];

  if (uniqueOnly) {
    for (const classKey of classes) {
      for (const band of LEVEL_BANDS) {
        const cell = classMatrix[classKey][band.key];
        if (cell.status !== 'missing' && cell.status !== 'weak') continue;

        gaps.push({
          classKey,
          band,
          reason: cell.count === 0 ? 'no fitting unique' : '1 fitting unique',
        });

        const statHint = Object.keys(CLASS_LEVEL_BONUSES[classKey] ?? {}).map((stat) => stat.toUpperCase()).join('/');
        const weaponHint = (CLASS_WEAPON_AFFINITY[classKey] ?? [])[0] ?? 'gear';
        recommendations.push({
          id: `${classKey}-${band.key}`,
          priority: Math.round((cell.count === 0 ? 2 : 1) * band.importance * 10),
          text: `Create level ${band.min}-${band.max} ${statHint}-focused unique ${weaponHint} for ${CLASS_LABELS[classKey]}`,
        });
      }
    }
    recommendations.sort((a, b) => b.priority - a.priority);
  }

  return { bands: LEVEL_BANDS, classes, classMatrix, statMatrix, slotMatrix, gaps, recommendations };
}

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
