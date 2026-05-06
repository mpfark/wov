import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { RACE_LABELS, CLASS_LABELS, getCharacterTitle } from '@/lib/game-data';
import ItemTooltipCard from '@/components/items/ItemTooltipCard';
import { useWeaponProgression } from '@/features/combat/hooks/useWeaponProgression';

const SLOT_LABELS: Record<string, string> = {
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', boots: 'Boots',
  ring: 'Ring', trinket: 'Trinket', main_hand: 'Main Hand', off_hand: 'Off Hand',
};

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-blue-400',
  unique: 'text-primary text-glow',
  soulforged: 'text-soulforged text-glow-soulforged',
};

const getInspectItemColor = (rarity: string) => RARITY_COLORS[rarity] || 'text-foreground';

interface EquippedItem {
  slot: string;
  item_name: string;
  item_type: string;
  rarity: string;
  stats: Record<string, number>;
  hands: number | null;
  durability_pct: number;
  item_level: number;
  description: string;
  illustration_url?: string | null;
  weapon_tag?: string | null;
  is_soulbound?: boolean;
}

interface PlayerInfo {
  id: string;
  name: string;
  level: number;
  race?: string;
  class?: string;
  gender?: string;
}

interface Props {
  player: PlayerInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function InspectSlot({ slot, item, classKey }: { slot: string; item: EquippedItem | undefined; classKey?: string }) {
  const weaponProgression = useWeaponProgression();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`w-[6.5rem] h-[3.25rem] p-1 border rounded text-center transition-colors ${
            item ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'
          }`}
        >
          <div className="text-[9px] text-muted-foreground capitalize">{SLOT_LABELS[slot]}</div>
          {item ? (
            <>
              <div className={`text-[10px] font-display truncate ${getInspectItemColor(item.rarity)}`}>
                {item.item_name}
                {item.hands === 2 && <span className="text-[9px] text-muted-foreground ml-1">(2H)</span>}
              </div>
              <div className="text-[9px] text-muted-foreground">{item.durability_pct}%</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground/50">Empty</div>
          )}
        </div>
      </TooltipTrigger>
      {item && (
        <TooltipContent className="bg-popover border-border z-50 max-w-xs">
          <ItemTooltipCard
            item={{
              name: item.item_name,
              rarity: item.rarity,
              is_soulbound: item.is_soulbound,
              item_type: item.item_type,
              slot: item.slot,
              hands: item.hands,
              weapon_tag: item.weapon_tag ?? null,
              level: item.item_level,
              stats: item.stats,
              illustration_url: item.illustration_url,
              description: item.description,
            }}
            weaponProgression={weaponProgression}
            classKey={classKey}
            durabilityPct={item.durability_pct}
            showValue={false}
          />
        </TooltipContent>
      )}
    </Tooltip>
  );
}

export default function InspectPlayerDialog({ player, open, onOpenChange }: Props) {
  const [items, setItems] = useState<EquippedItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !player) { setItems([]); return; }
    setLoading(true);
    supabase.rpc('inspect_character_equipment', { _character_id: player.id })
      .then(({ data }) => {
        setItems((data as EquippedItem[] | null) ?? []);
        setLoading(false);
      });
  }, [open, player?.id]);

  if (!player) return null;

  const getItem = (slot: string) => items.find(i => i.slot === slot);
  const isTwoHanded = getItem('main_hand')?.hands === 2;
  const title = getCharacterTitle(player.level, player.gender as 'male' | 'female' | undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-base">
            {title && <span className="text-primary/60 text-xs">{title}</span>}
            {player.name}
            <Badge variant="secondary" className="ml-auto text-[10px]">
              L{player.level} {CLASS_LABELS[player.class ?? ''] ?? ''} {RACE_LABELS[player.race ?? ''] ?? ''}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <TooltipProvider delayDuration={200}>
          {loading ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">Loading gear…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No equipment visible.</p>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <div className="grid grid-cols-3 gap-1 w-full justify-items-center">
                {/* Row 1: Trinket - Head - empty */}
                <InspectSlot slot="trinket" item={getItem('trinket')} />
                <InspectSlot slot="head" item={getItem('head')} />
                <div />
                {/* Row 2: empty - Amulet - empty */}
                <div />
                <InspectSlot slot="amulet" item={getItem('amulet')} />
                <div />
                {/* Row 3: Shoulders - Chest - Gloves */}
                <InspectSlot slot="shoulders" item={getItem('shoulders')} />
                <InspectSlot slot="chest" item={getItem('chest')} />
                <InspectSlot slot="gloves" item={getItem('gloves')} />
                {/* Row 4: Main Hand - Belt - Off Hand */}
                <InspectSlot slot="main_hand" item={getItem('main_hand')} />
                <InspectSlot slot="belt" item={getItem('belt')} />
                <InspectSlot slot="off_hand" item={isTwoHanded ? undefined : getItem('off_hand')} />
                {/* Row 5: Ring - Pants - empty */}
                <InspectSlot slot="ring" item={getItem('ring')} />
                <InspectSlot slot="pants" item={getItem('pants')} />
                <div />
                {/* Row 6: empty - Boots - empty */}
                <div />
                <InspectSlot slot="boots" item={getItem('boots')} />
                <div />
              </div>
            </div>
          )}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  );
}
