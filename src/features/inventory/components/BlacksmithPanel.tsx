import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import ScrollPanel from './ScrollPanel';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { Coins, Hammer } from 'lucide-react';
import { InventoryItem } from '@/features/inventory';
import { calculateRepairCost } from '@/lib/game-data';

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  gold: number;
  salvage: number;
  level: number;
  inventory: InventoryItem[];
  onGoldChange: (newGold: number) => void;
  onSalvageChange: (newSalvage: number) => void;
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
  item.is_soulbound ? 'text-soulforged text-glow-soulforged' : (RARITY_COLORS[item.rarity] || '');

const FORGE_SLOTS = [
  { value: 'main_hand', label: 'Main Hand' },
  { value: 'off_hand', label: 'Off Hand' },
  { value: 'head', label: 'Head' },
  { value: 'chest', label: 'Chest' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'gloves', label: 'Gloves' },
  { value: 'belt', label: 'Belt' },
  { value: 'pants', label: 'Pants' },
  { value: 'boots', label: 'Boots' },
  { value: 'ring', label: 'Ring' },
  { value: 'amulet', label: 'Amulet' },
  { value: 'trinket', label: 'Trinket' },
];

export default function BlacksmithPanel({ open, onClose, characterId, gold, salvage, level, inventory, onGoldChange, onSalvageChange, onInventoryChange, addLog }: Props) {
  const [repairing, setRepairing] = useState(false);
  const [forgeSlot, setForgeSlot] = useState<string>('');
  const [forging, setForging] = useState(false);
  const [forgedItem, setForgedItem] = useState<any>(null);
  const [sellAmount, setSellAmount] = useState(1);
  const [selling, setSelling] = useState(false);

  const damagedItems = inventory.filter(i => i.current_durability < 100);
  const isUnrepairable = (rarity: string) => rarity === 'unique';

  const salvageCost = 5 + level * 2;
  const goldCost = level * 5;
  const canForge = forgeSlot && salvage >= salvageCost && gold >= goldCost && !forging;

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

  const handleForge = async () => {
    if (!canForge) return;
    setForging(true);
    setForgedItem(null);
    try {
      const { data, error } = await supabase.functions.invoke('blacksmith-forge', {
        body: { character_id: characterId, slot: forgeSlot },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      setForgedItem(data.item);
      onGoldChange(data.gold_remaining);
      onSalvageChange(data.salvage_remaining);
      onInventoryChange();
      addLog(`🔩 The blacksmith forged: ${data.item.name} (${data.item.rarity})!`);
    } catch (e: any) {
      addLog(`❌ Forge failed: ${e.message || 'Unknown error'}`);
    }
    setForging(false);
  };

  const handleSellSalvage = async () => {
    if (sellAmount < 1 || sellAmount > salvage || selling) return;
    setSelling(true);
    try {
      const goldGain = sellAmount; // 1:1 ratio
      const newGold = gold + goldGain;
      const newSalvage = salvage - sellAmount;
      await supabase.from('characters').update({ gold: newGold, salvage: newSalvage }).eq('id', characterId);
      onGoldChange(newGold);
      onSalvageChange(newSalvage);
      addLog(`🔩 Sold ${sellAmount} salvage for ${goldGain} gold.`);
      setSellAmount(Math.min(sellAmount, newSalvage) || 1);
    } catch (e: any) {
      addLog(`❌ Sale failed: ${e.message || 'Unknown error'}`);
    }
    setSelling(false);
  };

  const totalRepairCost = damagedItems
    .filter(i => !isUnrepairable(i.item.rarity))
    .reduce((sum, inv) => sum + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <ScrollPanel icon="🔨" title="Blacksmith" className="max-w-lg">

        <div className="flex items-center justify-between text-sm mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Coins className="w-4 h-4 text-primary" />
              <span className="font-display text-primary">{gold}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm">🔩</span>
              <span className="font-display text-dwarvish">{salvage}</span>
            </div>
          </div>
        </div>

        <Tabs defaultValue="repair" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="repair" className="font-display text-xs">
              <Hammer className="w-3 h-3 mr-1" /> Repair
            </TabsTrigger>
            <TabsTrigger value="forge" className="font-display text-xs">
              🔩 Forge
            </TabsTrigger>
            <TabsTrigger value="sell" className="font-display text-xs">
              <Coins className="w-3 h-3 mr-1" /> Sell
            </TabsTrigger>
          </TabsList>

          <TabsContent value="repair" className="space-y-2">
            {damagedItems.filter(i => !isUnrepairable(i.item.rarity)).length > 1 && (
              <div className="flex justify-end">
                <Button size="sm" onClick={repairAll} disabled={repairing || gold < totalRepairCost}
                  className="font-display text-xs h-7">
                  <Hammer className="w-3 h-3 mr-1" /> Repair All ({totalRepairCost}g)
                </Button>
              </div>
            )}
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
                          Unique items cannot be restored by mortal hands.
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
          </TabsContent>

          <TabsContent value="forge" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Bring salvaged beast materials to the blacksmith to forge new equipment. Choose an equipment slot and the blacksmith will craft a random item scaled to your level.
            </p>

            <div className="space-y-2">
              <Select value={forgeSlot} onValueChange={setForgeSlot}>
                <SelectTrigger className="font-display text-sm">
                  <SelectValue placeholder="Choose equipment slot..." />
                </SelectTrigger>
                <SelectContent>
                  {FORGE_SLOTS.map(s => (
                    <SelectItem key={s.value} value={s.value} className="font-display text-sm">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center justify-between p-2 rounded border border-border bg-background/40">
                <div className="text-xs space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Cost:</span>
                    <span className={`font-display ${salvage >= salvageCost ? 'text-dwarvish' : 'text-destructive'}`}>
                      🔩 {salvageCost}
                    </span>
                    <span className="text-muted-foreground">+</span>
                    <span className={`font-display ${gold >= goldCost ? 'text-primary' : 'text-destructive'}`}>
                      {goldCost}g
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Rarity: <span className="text-foreground">Common 65%</span> / <span className="text-elvish">Uncommon 35%</span>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  onClick={handleForge} 
                  disabled={!canForge}
                  className="font-display text-xs h-8"
                >
                  {forging ? (
                    <span className="animate-pulse">Forging...</span>
                  ) : (
                    <>🔨 Forge</>
                  )}
                </Button>
              </div>
            </div>

            {forgedItem && (
              <div className="p-3 rounded border border-elvish/30 bg-elvish/5 space-y-1">
                <div className="text-xs text-muted-foreground font-display">Forged:</div>
                <div className={`font-display text-sm ${RARITY_COLORS[forgedItem.rarity] || ''}`}>
                  {forgedItem.name}
                </div>
                <div className="text-[10px] text-muted-foreground italic">{forgedItem.description}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Object.entries(forgedItem.stats || {}).map(([k, v]) => (
                    <span key={k} className="text-[10px] font-display text-elvish bg-elvish/10 px-1 rounded">
                      +{v as number} {k.toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="sell" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sell raw salvage materials to the blacksmith for gold. The blacksmith pays <span className="text-foreground font-display">1 gold per salvage</span>.
            </p>

            {salvage === 0 ? (
              <p className="text-xs text-muted-foreground italic">You have no salvage to sell.</p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Amount to sell:</span>
                    <span className="font-display text-dwarvish">🔩 {sellAmount}</span>
                  </div>
                  <Slider
                    min={1}
                    max={salvage}
                    step={1}
                    value={[sellAmount]}
                    onValueChange={([v]) => setSellAmount(v)}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>1</span>
                    <button
                      type="button"
                      className="text-primary hover:underline font-display"
                      onClick={() => setSellAmount(salvage)}
                    >
                      Sell All ({salvage})
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between p-2 rounded border border-border bg-background/40">
                  <div className="text-xs space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">You receive:</span>
                      <span className="font-display text-primary">
                        <Coins className="w-3 h-3 inline mr-0.5" />{sellAmount}g
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSellSalvage}
                    disabled={selling || sellAmount < 1 || sellAmount > salvage}
                    className="font-display text-xs h-8"
                  >
                    {selling ? (
                      <span className="animate-pulse">Selling...</span>
                    ) : (
                      <><Coins className="w-3 h-3 mr-1" /> Sell</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </ScrollPanel>
    </Dialog>
  );
}
