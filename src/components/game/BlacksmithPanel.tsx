import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Coins, Hammer } from 'lucide-react';
import { InventoryItem } from '@/hooks/useInventory';
import { calculateRepairCost } from '@/lib/game-data';

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  gold: number;
  inventory: InventoryItem[];
  onGoldChange: (newGold: number) => void;
  onInventoryChange: () => void;
  addLog: (msg: string) => void;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
};

const getItemColor = (item: { rarity: string; is_soulbound?: boolean }) =>
  item.is_soulbound ? 'text-soulforged' : (RARITY_COLORS[item.rarity] || '');

export default function BlacksmithPanel({ open, onClose, characterId, gold, inventory, onGoldChange, onInventoryChange, addLog }: Props) {
  const [repairing, setRepairing] = useState(false);

  const damagedItems = inventory.filter(i => i.current_durability < 100);
  const isUnrepairable = (rarity: string) => rarity === 'unique';

  const repairItem = async (inv: InventoryItem) => {
    if (isUnrepairable(inv.item.rarity)) return;
    const cost = calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity);
    if (gold < cost) {
      addLog('❌ Not enough gold!');
      return;
    }
    setRepairing(true);
    await supabase.from('character_inventory').update({ current_durability: 100 }).eq('id', inv.id);
    const newGold = gold - cost;
    await supabase.from('characters').update({ gold: newGold }).eq('id', characterId);
    onGoldChange(newGold);
    onInventoryChange();
    addLog(`🔨 Repaired ${inv.item.name} for ${cost} gold.`);
    setRepairing(false);
  };

  const repairAll = async () => {
    const repairableItems = damagedItems.filter(i => !isUnrepairable(i.item.rarity));
    const totalCost = repairableItems.reduce((sum, inv) =>
      sum + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);
    if (gold < totalCost) {
      addLog('❌ Not enough gold to repair all!');
      return;
    }
    setRepairing(true);
    for (const inv of repairableItems) {
      await supabase.from('character_inventory').update({ current_durability: 100 }).eq('id', inv.id);
    }
    const newGold = gold - totalCost;
    await supabase.from('characters').update({ gold: newGold }).eq('id', characterId);
    onGoldChange(newGold);
    onInventoryChange();
    addLog(`🔨 Repaired ${repairableItems.length} items for ${totalCost} gold.`);
    setRepairing(false);
  };

  const totalRepairCost = damagedItems
    .filter(i => !isUnrepairable(i.item.rarity))
    .reduce((sum, inv) => sum + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow flex items-center gap-2">
            <Hammer className="w-5 h-5" /> Blacksmith
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-sm mb-3">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-primary" />
            <span className="font-display text-primary">{gold} Gold</span>
          </div>
          {damagedItems.filter(i => !isUnrepairable(i.item.rarity)).length > 1 && (
            <Button size="sm" onClick={repairAll} disabled={repairing || gold < totalRepairCost}
              className="font-display text-xs h-7">
              <Hammer className="w-3 h-3 mr-1" /> Repair All ({totalRepairCost}g)
            </Button>
          )}
        </div>

        <div className="space-y-2">
          {damagedItems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">All your equipment is in good condition.</p>
          ) : damagedItems.map(inv => {
            const cantRepair = isUnrepairable(inv.item.rarity);
            const cost = cantRepair ? 0 : calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity);
            const durPct = inv.current_durability;

            return (
              <div key={inv.id} className={`p-2 rounded border border-border bg-background/40 space-y-1.5 ${cantRepair ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-sm font-display ${getItemColor(inv.item)}`}>{inv.item.name}</span>
                    {inv.equipped_slot && <span className="text-[10px] text-muted-foreground ml-1 capitalize">({inv.equipped_slot.replace('_', ' ')})</span>}
                  </div>
                  {cantRepair ? (
                    <div className="text-right">
                      <span className="text-[10px] text-destructive font-display block">Unrepairable</span>
                      <span className="text-[9px] text-muted-foreground italic">
                        {inv.item.rarity === 'unique' ? 'Unique items cannot be restored by mortal hands.' : 'Rare items are too finely crafted to repair.'}
                      </span>
                    </div>
                  ) : (
                    <Button size="sm" onClick={() => repairItem(inv)} disabled={repairing || gold < cost}
                      className="font-display text-xs h-7">
                      <Coins className="w-3 h-3 mr-1" /> {cost}g
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2 bg-background rounded-full overflow-hidden border border-border">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${durPct}%`,
                        backgroundColor: durPct > 50 ? 'hsl(var(--chart-2))' : durPct > 25 ? 'hsl(var(--chart-4))' : 'hsl(var(--destructive))',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{inv.current_durability}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
