import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { RACE_LABELS, CLASS_LABELS, getCharacterTitle } from '@/lib/game-data';

const SLOT_ORDER: string[] = [
  'head', 'amulet', 'shoulders', 'chest', 'gloves',
  'belt', 'pants', 'boots', 'ring', 'trinket',
  'main_hand', 'off_hand',
];

const SLOT_LABELS: Record<string, string> = {
  head: 'Head', amulet: 'Amulet', shoulders: 'Shoulders', chest: 'Chest',
  gloves: 'Gloves', belt: 'Belt', pants: 'Pants', boots: 'Boots',
  ring: 'Ring', trinket: 'Trinket', main_hand: 'Main Hand', off_hand: 'Off Hand',
};

const RARITY_CLASS: Record<string, string> = {
  unique: 'text-primary text-glow',
  uncommon: 'text-elvish',
  common: 'text-foreground',
};

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

  const sorted = [...items].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
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
        <ScrollArea className="max-h-[60vh]">
          {loading ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">Loading gear…</p>
          ) : sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No equipment visible.</p>
          ) : (
            <div className="space-y-1">
              {sorted.map((item) => {
                const statEntries = Object.entries(item.stats || {}).filter(([, v]) => v !== 0);
                return (
                  <div key={item.slot} className="p-2 bg-background/50 rounded border border-border">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide w-16 shrink-0">
                        {SLOT_LABELS[item.slot] ?? item.slot}
                      </span>
                      <span className={`text-xs font-display truncate flex-1 ${RARITY_CLASS[item.rarity] ?? 'text-foreground'}`}>
                        {item.item_name}
                        {item.hands === 2 && <span className="text-[9px] text-muted-foreground ml-1">(2H)</span>}
                      </span>
                      <span className="text-[9px] text-muted-foreground shrink-0">L{item.item_level}</span>
                    </div>
                    {statEntries.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-x-2">
                        {statEntries.map(([k, v]) => (
                          <span key={k} className="text-[10px] text-elvish">
                            {k.toUpperCase()} {v > 0 ? '+' : ''}{v}
                          </span>
                        ))}
                      </div>
                    )}
                    {item.durability_pct < 100 && (
                      <span className={`text-[9px] ${item.durability_pct < 25 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        Durability: {item.durability_pct}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
