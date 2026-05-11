import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMaterials, type MaterialEntry } from '@/features/inventory/hooks/useMaterials';

/**
 * Materials section — non-gem materials (salvage, future crafting mats).
 * Gems are rendered separately via GemPouch for now.
 */
export function MaterialsSection({ characterId }: { characterId: string }) {
  const { entries } = useMaterials(characterId);
  const nonGem = entries.filter(e => e.category !== 'gem');

  if (nonGem.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground italic">No crafting materials yet.</p>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap gap-1">
        {nonGem.map(m => <MaterialChip key={m.key} material={m} />)}
      </div>
    </TooltipProvider>
  );
}

function MaterialChip({ material }: { material: MaterialEntry }) {
  const dim = material.count === 0;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-display tabular-nums ${
            dim ? 'opacity-30 border-border' : 'border-border bg-background/40'
          }`}
        >
          <span>{material.icon || '🔩'}</span>
          <span>{material.count}</span>
          <span className="text-muted-foreground">{material.name}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[220px]">
        <div className="font-display">{material.name}</div>
        {material.description && (
          <div className="text-muted-foreground">{material.description}</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
