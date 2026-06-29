import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { Coins, Hammer } from 'lucide-react';
import { InventoryItem } from '@/features/inventory';
import { calculateRepairCost } from '@/lib/game-data';
import { Character } from '@/features/character';
import { useSoulforgeForge } from './SoulforgeTabContent';
import { GemPouch } from './GemPouch';
import { useMaterials, notifyMaterialsChanged } from '../hooks/useMaterials';
import { useForgeUpgradeView } from './useForgeUpgradeView';

type BlacksmithTab = 'repair' | 'forge' | 'enhance' | 'soulforge';

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
  isSoulforgeNode?: boolean;
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

const FORGE_SLOTS = [
  { value: 'main_hand', label: 'Main Hand' },
  { value: 'off_hand', label: 'Off Hand' },
  { value: 'head', label: 'Head' },
  { value: 'chest', label: 'Chest' },
  { value: 'gloves', label: 'Gloves' },
  { value: 'pants', label: 'Pants' },
];

export default function BlacksmithPanel({
  open, onClose, characterId, gold, level, inventory,
  onGoldChange, onInventoryChange, onCharacterRefresh: _onCharacterRefresh, addLog,
  isSoulforgeNode = false, character, npcName, npcFlavor,
}: Props) {
  const [tab, setTab] = useState<BlacksmithTab>('repair');
  const [repairing, setRepairing] = useState(false);
  const [sellAmount, setSellAmount] = useState(1);
  const [selling, setSelling] = useState(false);
  const { counts } = useMaterials(characterId);
  const salvage = counts.salvage ?? 0;

  const damagedItems = inventory.filter(i => i.current_durability < 100);
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
    addLog(`🔨 Repaired ${inv.item.name} for ${cost} gold.`);
    setRepairing(false);
  };

  const repairAll = async () => {
    const items = damagedItems.filter(i => !isUnrepairable(i.item.rarity));
    const totalCost = items.reduce((s, inv) =>
      s + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);
    if (gold < totalCost) { addLog('❌ Not enough gold to repair all!'); return; }
    setRepairing(true);
    for (const inv of items) {
      await supabase.from('character_inventory').update({ current_durability: 100 }).eq('id', inv.id);
    }
    const newGold = gold - totalCost;
    await supabase.from('characters').update({ gold: newGold }).eq('id', characterId);
    onGoldChange(newGold);
    onInventoryChange();
    addLog(`🔨 Repaired ${items.length} items for ${totalCost} gold.`);
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

  const totalRepairCost = damagedItems
    .filter(i => !isUnrepairable(i.item.rarity))
    .reduce((s, inv) => s + calculateRepairCost(100, inv.current_durability, inv.item.value, inv.item.rarity), 0);
  const repairableCount = damagedItems.filter(i => !isUnrepairable(i.item.rarity)).length;

  // ── Repair ────────────────────────────────────────────────────
  const repairLeft = damagedItems.length === 0 ? (
    <ServicePanelEmpty>All equipment is in good condition.</ServicePanelEmpty>
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
      <p>Equipment loses durability when you take hits in combat. At <span className="text-destructive font-display">0%</span>, items become unequipped and unusable.</p>
      <p>Repair cost scales with the item's <span className="text-primary font-display">value</span> and <span className="text-elvish font-display">rarity</span>.</p>
      <p className="text-destructive">⚠️ Unique items cannot be repaired — they are destroyed at 0% durability.</p>
    </div>
  );

  const repairFooter = repairableCount > 1 ? (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">Repair all {repairableCount} damaged items at once.</span>
      <Button size="sm" onClick={repairAll} disabled={repairing || gold < totalRepairCost} className="font-display text-xs h-8">
        <Hammer className="w-3 h-3 mr-1" /> Repair All ({totalRepairCost}g)
      </Button>
    </div>
  ) : (
    <div className="text-xs text-muted-foreground text-center">Click an item's price to repair it.</div>
  );

  // ── Forge (Craft + Upgrade) ───────────────────────────────────
  const { craftBlock, upgradeBlock } = useForgeUpgradeView({
    characterId, characterLevel: level, gold, inventory,
    slots: FORGE_SLOTS,
    onGoldChange, onInventoryChange, addLog,
    craftNoun: 'Gear',
  });

  const forgeLeft = (
    <div className="gap-section">
      <div className="rounded surface-row p-2">
        <GemPouch owned={Object.fromEntries(
          (Object.entries(counts).filter(([k]) => ['garnet','topaz','emerald','sapphire','pearl','amethyst'].includes(k)))
        )} />
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
          <span className="font-display tabular-nums text-primary">{gold}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span>🔩</span>
          <span className="font-display tabular-nums text-dwarvish">{salvage}</span>
        </span>
      </span>
    </span>
  );

  const showSoulforge = isSoulforgeNode && !!character;

  const tabs = (
    <Tabs value={tab} onValueChange={v => setTab(v as BlacksmithTab)} className="w-full">
      <TabsList className={`w-full grid ${showSoulforge ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <TabsTrigger value="repair" className="t-label text-[11px] data-[state=active]:text-primary">🔧 Repair</TabsTrigger>
        <TabsTrigger value="forge" className="t-label text-[11px] data-[state=active]:text-primary">⚒️ Forge</TabsTrigger>
        {showSoulforge && (
          <TabsTrigger value="soulforge" className="t-label text-[11px] data-[state=active]:text-soulforged text-soulforged">⚒️ Soulforge</TabsTrigger>
        )}
      </TabsList>
      <TabsContent value="repair" className="hidden" />
      <TabsContent value="forge" className="hidden" />
      {showSoulforge && <TabsContent value="soulforge" className="hidden" />}
    </Tabs>
  );

  const sf = useSoulforgeForge({
    character: character ?? null,
    onForged: () => { onInventoryChange(); },
  });

  let activeLeft: React.ReactNode;
  let activeRight: React.ReactNode | null;
  let activeFooter: React.ReactNode | null;
  let activeLeftTitle: string | undefined;
  let activeRightTitle: string | undefined;

  if (tab === 'soulforge' && showSoulforge) {
    activeLeft = sf.left;
    activeRight = sf.right ?? <ServicePanelEmpty>Awaiting your choice…</ServicePanelEmpty>;
    activeFooter = sf.footer ?? null;
    activeLeftTitle = (sf.leftTitle as string | undefined) ?? "The Soulwright's Anvil";
    activeRightTitle = sf.rightTitle as string | undefined;
  } else if (tab === 'forge') {
    activeLeft = forgeLeft;
    activeRight = upgradeBlock;
    activeFooter = null;
    activeLeftTitle = 'Craft & Pouch';
    activeRightTitle = 'Upgrade Your Gear';
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
