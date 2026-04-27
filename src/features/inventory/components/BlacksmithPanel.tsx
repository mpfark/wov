import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { Coins, Hammer } from 'lucide-react';
import { InventoryItem } from '@/features/inventory';
import { calculateRepairCost } from '@/lib/game-data';
import { Character } from '@/features/character';
import { useSoulforgeForge } from './SoulforgeTabContent';

type BlacksmithTab = 'repair' | 'forge' | 'soulforge';

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
  /** Whether the current node has the soulforge flag — adds a 3rd tab. */
  isSoulforgeNode?: boolean;
  /** Full character (only required when isSoulforgeNode). */
  character?: Character;
  /** Optional subtitle name + flavor for service-NPC framing. */
  npcName?: string;
  npcFlavor?: string;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  rare: 'text-dwarvish',
  unique: 'text-primary text-glow',
  soulforged: 'text-soulforged text-glow-soulforged',
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

const STAT_LABELS: Record<string, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  hp: 'HP', mp: 'MP', cp: 'CP', ac: 'AC', damage: 'DMG',
};

interface ForgePoolItem {
  id: string;
  name: string;
  rarity: string;
  level: number;
  stats: Record<string, number>;
  description: string;
  slot: string;
  hands: number | null;
  weapon_tag: string | null;
}

export default function BlacksmithPanel({
  open, onClose, characterId, gold, salvage, level, inventory,
  onGoldChange, onSalvageChange, onInventoryChange, addLog,
  isSoulforgeNode = false, character, npcName, npcFlavor,
}: Props) {
  const [tab, setTab] = useState<BlacksmithTab>('repair');
  const [repairing, setRepairing] = useState(false);
  const [forgeSlot, setForgeSlot] = useState<string>('');
  const [forging, setForging] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [forgePool, setForgePool] = useState<ForgePoolItem[]>([]);
  const [selectedForgeItem, setSelectedForgeItem] = useState<string | null>(null);
  const [sellAmount, setSellAmount] = useState(1);
  const [selling, setSelling] = useState(false);

  const damagedItems = inventory.filter(i => i.current_durability < 100);
  const isUnrepairable = (rarity: string) => rarity === 'unique';

  const salvageCost = 5 + level * 2;
  const goldCost = level * 5;
  const canForge = !!selectedForgeItem && salvage >= salvageCost && gold >= goldCost && !forging;

  const browseSlot = useCallback(async (slot: string) => {
    if (!slot) { setForgePool([]); return; }
    setBrowsing(true);
    setSelectedForgeItem(null);
    try {
      const { data, error } = await supabase.functions.invoke('blacksmith-forge', {
        body: { character_id: characterId, slot, mode: 'browse' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setForgePool(data.pool || []);
    } catch (e: any) {
      addLog(`❌ ${e.message || 'Failed to browse items'}`);
      setForgePool([]);
    }
    setBrowsing(false);
  }, [characterId, addLog]);

  useEffect(() => {
    if (open && forgeSlot) browseSlot(forgeSlot);
  }, [open, forgeSlot, browseSlot]);

  const repairItem = async (inv: InventoryItem) => {
    if (isUnrepairable(inv.item.rarity)) return;
    const cost = calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity);
    if (gold < cost) { addLog('❌ Not enough gold!'); return; }
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
    if (gold < totalCost) { addLog('❌ Not enough gold to repair all!'); return; }
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
    try {
      const { data, error } = await supabase.functions.invoke('blacksmith-forge', {
        body: { character_id: characterId, slot: forgeSlot, item_id: selectedForgeItem, mode: 'forge' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGoldChange(data.gold_remaining);
      onSalvageChange(data.salvage_remaining);
      onInventoryChange();
      addLog(`🔩 The blacksmith forged: ${data.item.name}!`);
      setForgePool(prev => prev.filter(i => i.id !== selectedForgeItem));
      setSelectedForgeItem(null);
    } catch (e: any) {
      addLog(`❌ Forge failed: ${e.message || 'Unknown error'}`);
    }
    setForging(false);
  };

  const handleSellSalvage = async () => {
    if (sellAmount < 1 || sellAmount > salvage || selling) return;
    setSelling(true);
    try {
      const goldGain = sellAmount;
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
  const repairableCount = damagedItems.filter(i => !isUnrepairable(i.item.rarity)).length;

  // ── Slot content ──────────────────────────────────────────────

  const repairLeft = damagedItems.length === 0 ? (
    <ServicePanelEmpty>All equipment is in good condition.</ServicePanelEmpty>
  ) : (
    <div className="space-y-1.5">
      {damagedItems.map(inv => {
        const cantRepair = isUnrepairable(inv.item.rarity);
        const cost = cantRepair ? 0 : calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity);
        const durPct = inv.current_durability;
        return (
          <div key={inv.id} className={`p-2 rounded border border-border bg-background/40 space-y-1.5 ${cantRepair ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <span className={`text-sm font-display ${getItemColor(inv.item)} block truncate`}>{inv.item.name}</span>
                {inv.equipped_slot && <span className="text-[10px] text-muted-foreground capitalize">({inv.equipped_slot.replace('_', ' ')})</span>}
              </div>
              {cantRepair ? (
                <span className="text-[10px] text-destructive font-display shrink-0">Unrepairable</span>
              ) : (
                <Button size="sm" onClick={() => repairItem(inv)} disabled={repairing || gold < cost}
                  className="font-display text-xs h-7 shrink-0 ml-1">
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
  );

  const repairRight = (
    <div className="space-y-3 text-[11px] text-muted-foreground">
      <p>Equipment loses durability when you take hits in combat. At <span className="text-destructive font-display">0%</span>, items become unequipped and unusable.</p>
      <p>Repair cost scales with the item's <span className="text-primary font-display">value</span> and <span className="text-elvish font-display">rarity</span>.</p>
      <p className="text-destructive">⚠️ Unique items cannot be repaired — they are destroyed at 0% durability.</p>
      {repairableCount > 0 && (
        <div className="border-t border-border pt-2 text-foreground">
          <span className="font-display text-xs">Pending repairs: </span>
          <span>{repairableCount} item{repairableCount === 1 ? '' : 's'}</span>
          <span className="ml-2 text-primary font-display">{totalRepairCost}g total</span>
        </div>
      )}
    </div>
  );

  const repairFooter = repairableCount > 1 ? (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        Repair all {repairableCount} damaged items at once.
      </span>
      <Button size="sm" onClick={repairAll} disabled={repairing || gold < totalRepairCost}
        className="font-display text-xs h-8">
        <Hammer className="w-3 h-3 mr-1" /> Repair All ({totalRepairCost}g)
      </Button>
    </div>
  ) : (
    <div className="text-xs text-muted-foreground text-center">
      Click an item's price to repair it.
    </div>
  );

  const forgeLeft = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Select value={forgeSlot} onValueChange={v => { setForgeSlot(v); setForgePool([]); setSelectedForgeItem(null); }}>
          <SelectTrigger className="font-display text-sm h-8">
            <SelectValue placeholder="Choose slot..." />
          </SelectTrigger>
          <SelectContent>
            {FORGE_SLOTS.map(s => (
              <SelectItem key={s.value} value={s.value} className="font-display text-sm">{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {forgeSlot && (
          <div className="text-[10px] text-muted-foreground flex items-center gap-2">
            <span>Cost:</span>
            <span className={`font-display ${salvage >= salvageCost ? 'text-dwarvish' : 'text-destructive'}`}>🔩 {salvageCost}</span>
            <span>+</span>
            <span className={`font-display ${gold >= goldCost ? 'text-primary' : 'text-destructive'}`}>{goldCost}g</span>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground italic">Common items only. Pick a slot to browse available equipment for your level.</p>
      </div>

      {/* Sell Salvage */}
      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="font-display text-xs text-muted-foreground">🔩 Sell Salvage</h3>
        {salvage === 0 ? (
          <p className="text-xs text-muted-foreground italic">No salvage to sell.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-display text-dwarvish">🔩 {sellAmount} → {sellAmount}g</span>
            </div>
            <Slider min={1} max={salvage} step={1} value={[sellAmount]} onValueChange={([v]) => setSellAmount(v)} className="w-full" />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>1</span>
              <button type="button" className="text-primary hover:underline font-display" onClick={() => setSellAmount(salvage)}>
                All ({salvage})
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={handleSellSalvage} disabled={selling || sellAmount < 1}
              className="w-full font-display text-xs h-7">
              {selling ? <span className="animate-pulse">Selling...</span> : <><Coins className="w-3 h-3 mr-1" /> Sell Salvage</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const forgeRight = (
    <div className="space-y-1">
      {browsing && <p className="text-xs text-muted-foreground italic animate-pulse">Searching the forge...</p>}
      {!browsing && forgeSlot && forgePool.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No items available for this slot at your level.</p>
      )}
      {!browsing && !forgeSlot && (
        <p className="text-xs text-muted-foreground italic">Select a slot to browse items.</p>
      )}
      <TooltipProvider delayDuration={200}>
        {forgePool.map(item => (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSelectedForgeItem(item.id === selectedForgeItem ? null : item.id)}
                className={`w-full text-left p-2 rounded border transition-colors ${
                  item.id === selectedForgeItem
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-background/40 hover:bg-background/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-display text-foreground">{item.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.weapon_tag && (
                      <span className="text-[10px] text-muted-foreground capitalize">{item.weapon_tag}</span>
                    )}
                    {item.hands && (
                      <span className="text-[10px] text-muted-foreground">{item.hands}H</span>
                    )}
                    <span className="text-[10px] text-muted-foreground">Lv{item.level}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {Object.entries(item.stats || {}).filter(([,v]) => (v as number) !== 0).map(([k, v]) => (
                    <span key={k} className="text-[10px] font-display text-elvish bg-elvish/10 px-1 rounded">
                      +{v as number} {STAT_LABELS[k] || k.toUpperCase()}
                    </span>
                  ))}
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="bg-popover border-border z-50 max-w-xs">
              {(() => {
                const equipped = inventory.find(i => i.equipped_slot === item.slot);
                const equippedStats = (equipped?.item?.stats || {}) as Record<string, number>;
                const forgeStats = (item.stats || {}) as Record<string, number>;
                const allKeys = [...new Set([...Object.keys(forgeStats), ...Object.keys(equippedStats)])];
                return (
                  <>
                    <p className="font-display text-foreground">{item.name}</p>
                    {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    <p className="text-[10px] text-muted-foreground capitalize">{item.slot?.replace('_', ' ')} · Lv{item.level}</p>
                    {item.hands && <p className="text-xs text-muted-foreground">{item.hands === 2 ? 'Two-Handed' : 'One-Handed'}</p>}
                    {item.weapon_tag && <p className="text-xs text-muted-foreground capitalize">{item.weapon_tag}</p>}
                    {allKeys.filter(k => (forgeStats[k] || 0) !== 0 || (equippedStats[k] || 0) !== 0).map(k => {
                      const fv = forgeStats[k] || 0;
                      const ev = equippedStats[k] || 0;
                      const diff = fv - ev;
                      const label = STAT_LABELS[k] || k.toUpperCase();
                      return (
                        <p key={k} className="text-xs flex items-center gap-1">
                          <span>+{fv} {label}</span>
                          {equipped && diff !== 0 && (
                            <span className={`text-[10px] font-display ${diff > 0 ? 'text-chart-2' : 'text-destructive'}`}>
                              ({diff > 0 ? '▲' : '▼'}{Math.abs(diff)})
                            </span>
                          )}
                        </p>
                      );
                    })}
                    {equipped ? (
                      <p className="text-[10px] text-muted-foreground mt-1 border-t border-border pt-1">
                        vs. <span className={`font-display ${getItemColor(equipped.item)}`}>{equipped.item.name}</span>
                      </p>
                    ) : (
                      <p className="text-[10px] text-elvish mt-1">No item equipped in this slot</p>
                    )}
                  </>
                );
              })()}
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </div>
  );

  const forgeFooter = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {selectedForgeItem
          ? <>Forging selected item — costs <span className="text-dwarvish">🔩 {salvageCost}</span> + <span className="text-primary">{goldCost}g</span></>
          : 'Select an item from the forge pool.'}
      </span>
      <Button
        size="sm"
        onClick={handleForge}
        disabled={!canForge}
        className="font-display text-xs h-8"
      >
        {forging ? <span className="animate-pulse">Forging...</span> : <>🔨 Forge Selected Item</>}
      </Button>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────

  const subtitle = (
    <span className="inline-flex flex-col items-center gap-0.5">
      {npcName && (
        <span className="font-display text-elvish">
          💬 {npcName}
          {npcFlavor && <span className="text-muted-foreground italic"> — {npcFlavor}</span>}
        </span>
      )}
      <span className="inline-flex items-center gap-3">
        <span className="inline-flex items-center gap-1">
          <Coins className="w-3 h-3 text-primary" />
          <span className="font-display text-primary">{gold}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span>🔩</span>
          <span className="font-display text-dwarvish">{salvage}</span>
        </span>
      </span>
    </span>
  );

  const showSoulforge = isSoulforgeNode && !!character;

  const tabs = (
    <Tabs value={tab} onValueChange={v => setTab(v as BlacksmithTab)} className="w-full">
      <TabsList className={`w-full grid ${showSoulforge ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <TabsTrigger value="repair" className="font-display text-xs">🔧 Repair</TabsTrigger>
        <TabsTrigger value="forge" className="font-display text-xs">⚒️ Forge</TabsTrigger>
        {showSoulforge && (
          <TabsTrigger value="soulforge" className="font-display text-xs text-soulforged">⚒️ Soulforge</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="repair" className="hidden" />
      <TabsContent value="forge" className="hidden" />
      {showSoulforge && <TabsContent value="soulforge" className="hidden" />}
    </Tabs>
  );

  // Soulforge slots — hook always called (state persists across tabs).
  // Pass the real character or null; the hook returns a stable "loading"
  // slot tree when no character is present, so we never render the
  // placeholder's misleading "not worthy" branch.
  const sf = useSoulforgeForge({
    character: character ?? null,
    onForged: () => { onInventoryChange(); },
  });

  let activeLeft: typeof repairLeft;
  let activeRight: typeof repairRight | null;
  let activeFooter: typeof repairFooter | null;
  let activeLeftTitle: string | undefined;
  let activeRightTitle: string | undefined;

  if (tab === 'soulforge' && showSoulforge) {
    activeLeft = sf.left as typeof repairLeft;
    activeRight = (sf.right ?? <ServicePanelEmpty>Awaiting your choice…</ServicePanelEmpty>) as typeof repairRight;
    activeFooter = (sf.footer ?? null) as typeof repairFooter | null;
    activeLeftTitle = (sf.leftTitle as string | undefined) ?? "The Soulwright's Anvil";
    activeRightTitle = sf.rightTitle as string | undefined;
  } else if (tab === 'forge') {
    activeLeft = forgeLeft;
    activeRight = forgeRight;
    activeFooter = forgeFooter;
    activeLeftTitle = 'Forge Options';
    activeRightTitle = 'Available Items';
  } else {
    activeLeft = repairLeft;
    activeRight = repairRight;
    activeFooter = repairFooter;
    activeLeftTitle = 'Damaged Items';
    activeRightTitle = 'How Repair Works';
  }

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      icon="🔨"
      title="Blacksmith"
      subtitle={subtitle}
      tabs={tabs}
      leftTitle={activeLeftTitle}
      rightTitle={activeRightTitle}
      left={activeLeft}
      right={activeRight ?? undefined}
      footer={activeFooter ?? undefined}
    />
  );
}
