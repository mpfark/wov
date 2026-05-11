import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GEM_CATALOG, GemKey, PRIMARY_GEM_KEYS, HYBRID_GEM_KEYS } from '@/shared/formulas/gems';

interface GemPouchProps {
  owned: Record<string, number>;
  /** When true, dim gem types with 0 count rather than hiding them. */
  showEmpty?: boolean;
}

function GemDot({ gemKey, count }: { gemKey: GemKey; count: number }) {
  const def = GEM_CATALOG[gemKey];
  const dim = count === 0;
  const statLabel = def.stats.map(s => s.toUpperCase()).join(' + ');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
            dim ? 'opacity-30 border-border' : 'border-border bg-background/40'
          }`}
        >
          <span
            className="inline-block w-2.5 h-2.5 rounded-full border border-border"
            style={{ backgroundColor: def.color }}
          />
          <span className="text-[10px] font-display tabular-nums">{count}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="font-display">{def.name} {def.isHybrid && '(hybrid)'}</div>
        <div className="text-muted-foreground">{statLabel}</div>
      </TooltipContent>
    </Tooltip>
  );
}

export function GemPouch({ owned, showEmpty = true }: GemPouchProps) {
  const primaries = PRIMARY_GEM_KEYS.filter(k => showEmpty || (owned[k] || 0) > 0);
  const hybrids = HYBRID_GEM_KEYS.filter(k => showEmpty || (owned[k] || 0) > 0);
  const empty = primaries.length === 0 && hybrids.length === 0;
  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-1">
        <div className="text-[10px] text-muted-foreground font-display flex items-center gap-1">
          💠 Gems
        </div>
        {empty ? (
          <p className="text-[10px] text-muted-foreground italic">No gems yet — slay foes to find them.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {primaries.map(k => <GemDot key={k} gemKey={k} count={owned[k] || 0} />)}
            {hybrids.length > 0 && <span className="w-px self-stretch bg-border mx-0.5" />}
            {hybrids.map(k => <GemDot key={k} gemKey={k} count={owned[k] || 0} />)}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export function GemBadge({ gemKey }: { gemKey: GemKey | null | undefined }) {
  if (!gemKey) return null;
  const def = GEM_CATALOG[gemKey];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-[10px] font-display px-1 py-0.5 rounded border border-border bg-background/40">
            <span
              className="inline-block w-2 h-2 rounded-full border border-border"
              style={{ backgroundColor: def.color }}
            />
            <span>{def.name}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          Requires 1 {def.name} to forge ({def.stats.map(s => s.toUpperCase()).join(' + ')}).
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
