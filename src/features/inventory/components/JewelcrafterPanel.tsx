import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ServicePanelShell, ServicePanelEmpty, useMiniLog } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { Coins, Gem } from 'lucide-react';
import { InventoryItem } from '@/features/inventory';
import { calculateRepairCost } from '@/lib/game-data';
import { Character } from '@/features/character';
import { GemPouch } from './GemPouch';
import { useMaterials, notifyMaterialsChanged } from '../hooks/useMaterials';
import { GEM_CATALOG, GemKey, PRIMARY_GEM_KEYS, GEM_SALVAGE_COST_PRIMARY } from '@/shared/formulas/gems';
import { GemIcon } from '@/components/icons/GemIcon';
import { useForgeUpgradeView } from './useForgeUpgradeView';

type JewelcrafterTab = 'repair' | 'forge' | 'enhance' | 'gems';

const JEWELRY_SLOTS = new Set(['ring', 'trinket']);
const FORGE_SLOTS = [
  { value: 'ring', label: 'Ring' },
  { value: 'trinket', label: 'Trinket' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  characterId: string;
  gold: number;
  level: number;
  inventory: InventoryItem[];
  onGoldChange: (newGold: number) => void;
  onInventoryChange: () => void;
  onCharacterRefresh?: () => void;
  addLog: (msg: string) => void;
  character?: Character;
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
const getItemColor = (it: { rarity: string; is_soulbound?: boolean }) =>
  it.is_soulbound ? 'text-soulforged text-glow-soulforged' : (RARITY_COLORS[it.rarity] || '');

export default function JewelcrafterPanel({
  open, onClose, characterId, gold, level, inventory,
  onGoldChange, onInventoryChange, onCharacterRefresh: _onCharacterRefresh, addLog,
  character: _character, npcName, npcFlavor,
}: Props) {
  const [tab, setTab] = useState<JewelcrafterTab>('repair');
  const [repairing, setRepairing] = useState(false);
  const [sellAmount, setSellAmount] = useState(1);
  const [selling, setSelling] = useState(false);
  const [cutting, setCutting] = useState<string | null>(null);
  const { counts } = useMaterials(characterId);
  const salvage = counts.salvage ?? 0;
  const ownedGems: Record<string, number> = {};
  for (const k of PRIMARY_GEM_KEYS) if ((counts[k] || 0) > 0) ownedGems[k] = counts[k];

  const jewelryInventory = inventory.filter(i => JEWELRY_SLOTS.has(i.item.slot as string));
  const damagedItems = jewelryInventory.filter(i => i.current_durability < 100);
  const isUnrepairable = (rarity: string) => rarity === 'unique';

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
    addLog(`💎 Refurbished ${inv.item.name} for ${cost} gold.`);
    setRepairing(false);
  };

  const repairAll = async () => {
    const items = damagedItems.filter(i => !isUnrepairable(i.item.rarity));
    const totalCost = items.reduce((s, inv) =>
      s + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);
    if (gold < totalCost) { addLog('❌ Not enough gold to refurbish all!'); return; }
    setRepairing(true);
    for (const inv of items) {
      await supabase.from('character_inventory').update({ current_durability: 100 }).eq('id', inv.id);
    }
    const newGold = gold - totalCost;
    await supabase.from('characters').update({ gold: newGold }).eq('id', characterId);
    onGoldChange(newGold);
    onInventoryChange();
    addLog(`💎 Refurbished ${items.length} items for ${totalCost} gold.`);
    setRepairing(false);
  };

  const handleSellSalvage = async () => {
    if (sellAmount < 1 || sellAmount > salvage || selling) return;
    setSelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('sell-material', {
        body: { character_id: characterId, material_key: 'salvage', amount: sellAmount },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      onGoldChange(data.gold_remaining);
      notifyMaterialsChanged(characterId);
      addLog(`🔩 Sold ${data.amount_sold} salvage for ${data.gold_gained} gold.`);
      setSellAmount(Math.min(sellAmount, salvage - data.amount_sold) || 1);
    } catch (e: any) {
      addLog(`❌ Sale failed: ${e.message || 'Unknown error'}`);
    }
    setSelling(false);
  };

  const handleTradeGem = async (gemKey: GemKey) => {
    if (cutting) return;
    if (salvage < GEM_SALVAGE_COST_PRIMARY) { addLog('❌ Not enough salvage.'); return; }
    setCutting(`trade:${gemKey}`);
    try {
      const { data, error } = await supabase.functions.invoke('jewelcrafter-gemcutter', {
        body: { character_id: characterId, mode: 'trade_gem', gem_key: gemKey },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      notifyMaterialsChanged(characterId);
      addLog(`💠 Traded ${data.salvage_spent} salvage for 1 ${data.gem_name}.`);
    } catch (e: any) {
      addLog(`❌ Gem trade failed: ${e.message || 'Unknown error'}`);
    }
    setCutting(null);
  };

  const totalRepairCost = damagedItems
    .filter(i => !isUnrepairable(i.item.rarity))
    .reduce((s, inv) => s + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);
  const repairableCount = damagedItems.filter(i => !isUnrepairable(i.item.rarity)).length;

  const repairLeft = damagedItems.length === 0 ? (
    <ServicePanelEmpty>All jewelry is in good condition.</ServicePanelEmpty>
  ) : (
    <div className="gap-row">
      {damagedItems.map(inv => {
        const cantRepair = isUnrepairable(inv.item.rarity);
        const cost = cantRepair ? 0 : calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity);
        const durPct = inv.current_durability;
        return (
          <div key={inv.id} className={`p-2 rounded surface-row gap-row ${cantRepair ? 'opacity-60' : ''}`}>
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
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${durPct}%`, backgroundColor: durPct > 50 ? 'hsl(var(--chart-2))' : durPct > 25 ? 'hsl(var(--chart-4))' : 'hsl(var(--destructive))' }} />
              </div>
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{inv.current_durability}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const repairRight = (
    <div className="gap-section text-[11px] text-muted-foreground">
      <p>The jeweler refurbishes <span className="text-elvish font-display">rings and trinkets</span> only. For weapons and armor, visit a blacksmith.</p>
      <p className="text-destructive">⚠️ Unique items cannot be refurbished — they are destroyed at 0% durability.</p>
    </div>
  );

  const repairFooter = repairableCount > 1 ? (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">Refurbish all {repairableCount} damaged jewelry pieces at once.</span>
      <Button size="sm" onClick={repairAll} disabled={repairing || gold < totalRepairCost} className="font-display text-xs h-8">
        <Gem className="w-3 h-3 mr-1" /> Refurbish All ({totalRepairCost}g)
      </Button>
    </div>
  ) : (
    <div className="text-xs text-muted-foreground text-center">Click an item's price to refurbish it.</div>
  );

  // ── Forge (Craft) + Enhance ───────────────────────────────────
  const { craftBlock, craftBasesList, enhanceLeft, enhanceRight } = useForgeUpgradeView({
    characterId, characterLevel: level, gold, inventory,
    slots: FORGE_SLOTS,
    onGoldChange, onInventoryChange, addLog,
    craftNoun: 'Jewelry',
  });

  const forgeLeft = (
    <div className="gap-section">
      <div className="rounded surface-row p-2">
        <GemPouch owned={ownedGems} />
      </div>
      {craftBlock}
      <div className="gap-group border-t border-border-subtle pt-3">
        <h3 className="t-label text-[11px]">🔩 Sell Salvage</h3>
        {salvage === 0 ? (
          <p className="text-xs text-muted-foreground italic">No salvage to sell.</p>
        ) : (
          <div className="gap-group">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-display text-dwarvish">🔩 {sellAmount} → {sellAmount}g</span>
            </div>
            <Slider min={1} max={salvage} step={1} value={[sellAmount]} onValueChange={([v]) => setSellAmount(v)} className="w-full" />
            <Button size="sm" variant="outline" onClick={handleSellSalvage} disabled={selling || sellAmount < 1}
              className="w-full font-display text-xs h-7">
              {selling ? <span className="animate-pulse">Selling…</span> : <><Coins className="w-3 h-3 mr-1" /> Sell Salvage</>}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  // ── Gems tab: trade salvage → primary gem (hybrid combine retired)
  const gemsLeft = (
    <div className="gap-section">
      <div className="rounded surface-row p-2">
        <GemPouch owned={ownedGems} />
      </div>
      <div className="gap-group">
        <h3 className="t-label text-[11px]">🔩 Trade Salvage → Primary Gem</h3>
        <p className="text-[10px] text-muted-foreground italic">
          {GEM_SALVAGE_COST_PRIMARY} salvage per gem. Apply gems to items via the Forge tab to add stats.
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRIMARY_GEM_KEYS.map(key => {
            const def = GEM_CATALOG[key];
            const owned = ownedGems[key] || 0;
            const disabled = salvage < GEM_SALVAGE_COST_PRIMARY || cutting !== null;
            return (
              <Button key={key} size="sm" variant="outline"
                onClick={() => handleTradeGem(key)} disabled={disabled}
                className="font-display text-[11px] h-8 justify-between gap-1 px-2">
                <span className="inline-flex items-center gap-1.5">
                  <GemIcon color={def.color} size={12} title={def.name} />
                  {def.name}
                </span>
                <span className="text-muted-foreground">×{owned}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const gemsRight = (
    <div className="gap-section text-[11px] text-muted-foreground">
      <p>Each <span className="text-foreground font-display">primary gem</span> grants <span className="text-elvish font-display">+1 to one attribute</span> when applied to a player-upgradeable item at the forge.</p>
      <ul className="list-disc pl-4 gap-row">
        <li><span className="font-display">Garnet</span> → STR</li>
        <li><span className="font-display">Topaz</span> → DEX</li>
        <li><span className="font-display">Emerald</span> → CON</li>
        <li><span className="font-display">Sapphire</span> → INT</li>
        <li><span className="font-display">Pearl</span> → WIS</li>
        <li><span className="font-display">Amethyst</span> → CHA</li>
      </ul>
      <p>Apply gems repeatedly to stack the same stat (subject to the per-item cap and total stat budget).</p>
    </div>
  );

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
          <span className="font-display tabular-nums text-primary">{gold}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span>🔩</span>
          <span className="font-display tabular-nums text-dwarvish">{salvage}</span>
        </span>
      </span>
    </span>
  );

  const tabs = (
    <Tabs value={tab} onValueChange={v => setTab(v as JewelcrafterTab)} className="w-full">
      <TabsList className="w-full grid grid-cols-4">
        <TabsTrigger value="repair" className="t-label text-[11px] data-[state=active]:text-primary">🔧 Refurbish</TabsTrigger>
        <TabsTrigger value="forge" className="t-label text-[11px] data-[state=active]:text-primary">💎 Forge</TabsTrigger>
        <TabsTrigger value="enhance" className="t-label text-[11px] data-[state=active]:text-primary">💠 Enhance</TabsTrigger>
        <TabsTrigger value="gems" className="t-label text-[11px] data-[state=active]:text-primary">💠 Gemcutter</TabsTrigger>
      </TabsList>
      <TabsContent value="repair" className="hidden" />
      <TabsContent value="forge" className="hidden" />
      <TabsContent value="enhance" className="hidden" />
      <TabsContent value="gems" className="hidden" />
    </Tabs>
  );

  const forgeRight = (
    <div className="gap-section">
      <div className="text-[11px] text-muted-foreground">
        <p>Plain rings and trinkets are blank — no stats until you socket gems. Pick a slot on the left to see the variants the jeweler can craft for you, then head to the <span className="text-primary font-display">Enhance</span> tab.</p>
      </div>
      <div className="border-t border-border-subtle pt-2">
        {craftBasesList}
      </div>
    </div>
  );

  let activeLeft: React.ReactNode;
  let activeRight: React.ReactNode | null;
  let activeFooter: React.ReactNode | null;
  let activeLeftTitle: string | undefined;
  let activeRightTitle: string | undefined;

  if (tab === 'forge') {
    activeLeft = forgeLeft;
    activeRight = forgeRight;
    activeFooter = null;
    activeLeftTitle = 'Craft & Pouch';
    activeRightTitle = 'How the Forge Works';
  } else if (tab === 'enhance') {
    activeLeft = enhanceLeft;
    activeRight = enhanceRight;
    activeFooter = null;
    activeLeftTitle = 'Eligible Jewelry';
    activeRightTitle = 'Socket Gems';
  } else if (tab === 'gems') {
    activeLeft = gemsLeft;
    activeRight = gemsRight;
    activeFooter = null;
    activeLeftTitle = 'Trade Salvage';
    activeRightTitle = 'How Gems Work';
  } else {
    activeLeft = repairLeft;
    activeRight = repairRight;
    activeFooter = repairFooter;
    activeLeftTitle = 'Damaged Jewelry';
    activeRightTitle = 'How Refurbishing Works';
  }

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      icon="💎"
      title="Jewelcrafter"
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
