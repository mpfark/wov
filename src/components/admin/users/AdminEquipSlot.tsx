import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SLOT_LABELS, RARITY_COLORS } from './constants';
import type { AdminInventoryItem } from './constants';
import ItemIllustration from '@/components/items/ItemIllustration';

interface Props {
  slot: string;
  item: AdminInventoryItem | undefined;
  blocked: boolean;
}

export default function AdminEquipSlot({ slot, item, blocked }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] h-[3.25rem] p-1 border rounded text-center transition-colors ${
            blocked ? 'border-border/30 bg-background/10 opacity-50' :
            item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
          }`}
        >
          <div className="text-[9px] text-muted-foreground capitalize">{SLOT_LABELS[slot]}</div>
          {blocked ? (
            <div className="text-[10px] text-muted-foreground/50">2H</div>
          ) : item ? (
            <>
              <div className={`text-[10px] font-display truncate ${RARITY_COLORS[item.item.rarity]}`}>
                {item.item.name}
              </div>
              <div className="text-[9px] text-muted-foreground">{item.current_durability}%</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground/50">Empty</div>
          )}
        </div>
      </TooltipTrigger>
      {item && !blocked && (
        <TooltipContent className="bg-popover border-border z-50">
          <ItemIllustration url={item.item.illustration_url} alt={item.item.name} />
          <p className={`font-display ${RARITY_COLORS[item.item.rarity]}`}>{item.item.name}</p>
          <p className="text-xs text-muted-foreground">{item.item.description}</p>
          {item.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{SLOT_LABELS[item.item.slot] || item.item.slot} · {item.item.item_type}</p>}
          {!item.item.slot && <p className="text-[10px] text-muted-foreground capitalize">{item.item.item_type}</p>}
          {item.item.hands && <p className="text-xs text-muted-foreground">{item.item.hands === 2 ? 'Two-Handed' : 'One-Handed'}</p>}
          {Object.entries(item.item.stats || {}).map(([k, v]) => (
            <p key={k} className={`text-xs ${k === 'hp_regen' ? 'text-elvish' : ''}`}>
              {k === 'hp_regen' ? `+${v as number} Regen` : `+${v as number} ${k.toUpperCase()}`}
            </p>
          ))}
          <p className="text-[10px] text-muted-foreground">Durability: {item.current_durability}% | Value: {item.item.value}g</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}

