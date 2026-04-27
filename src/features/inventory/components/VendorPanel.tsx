import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ServicePanelShell, ServicePanelEmpty } from '@/components/ui/ServicePanelShell';
import { supabase } from '@/integrations/supabase/client';
import { Coins, ArrowUpFromLine } from 'lucide-react';
import { InventoryItem } from '@/features/inventory';
import { getChaSellMultiplier, getChaBuyDiscount, getStatModifier } from '@/lib/game-data';

interface VendorItem {
  id: string;
  item_id: string;
  price: number;
  stock: number;
  item: {
    id: string;
    name: string;
    description: string;
    rarity: string;
    slot: string | null;
    item_type: string;
    value: number;
    stats?: Record<string, number>;
    is_soulbound?: boolean;
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  characterId: string;
  gold: number;
  cha: number;
  equipmentBonuses?: Record<string, number>;
  inventory: InventoryItem[];
  onGoldChange: (newGold: number) => void;
  onInventoryChange: () => void;
  addLog: (msg: string) => void;
  /** Optional shopkeeper framing. */
  npcName?: string;
  npcFlavor?: string;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  unique: 'text-primary text-glow',
  soulforged: 'text-soulforged text-glow-soulforged',
};

const getItemColor = (item: { rarity: string; is_soulbound?: boolean }) =>
  item.is_soulbound ? 'text-soulforged text-glow-soulforged' : (RARITY_COLORS[item.rarity] || '');

function statSummary(stats?: Record<string, number>): string {
  if (!stats) return '';
  const parts = Object.entries(stats)
    .filter(([, v]) => v !== 0)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.toUpperCase()}`);
  return parts.join(', ');
}

export default function VendorPanel({ open, onClose, nodeId, characterId, gold, cha, equipmentBonuses = {}, inventory, onGoldChange, onInventoryChange, addLog }: Props) {
  const effectiveCha = cha + (equipmentBonuses.cha || 0);
  const buyDiscount = getChaBuyDiscount(effectiveCha);
  const sellMultiplier = getChaSellMultiplier(effectiveCha);
  const chaMod = getStatModifier(effectiveCha);

  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [selectedBuyId, setSelectedBuyId] = useState<string | null>(null);
  const [selectedSellId, setSelectedSellId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('vendor_inventory')
      .select('*, item:items(*)')
      .eq('node_id', nodeId)
      .then(({ data }) => {
        if (data) setVendorItems(data as unknown as VendorItem[]);
      });
  }, [open, nodeId]);

  const getDiscountedPrice = (basePrice: number) => Math.max(1, Math.floor(basePrice * (1 - buyDiscount)));
  const getSellPrice = (inv: InventoryItem) => Math.max(1, Math.floor(inv.item.value * sellMultiplier));

  const sellableItems = useMemo(
    () => inventory.filter(i => !i.equipped_slot && !i.item.is_soulbound && !i.is_pinned),
    [inventory],
  );

  // Stack vendor items by item_id for the buy column.
  const stackedBuy = useMemo(() => {
    const acc: Record<string, { vi: VendorItem; count: number; totalStock: number }> = {};
    for (const vi of vendorItems) {
      if (acc[vi.item_id]) {
        acc[vi.item_id].count += 1;
        acc[vi.item_id].totalStock += vi.stock;
      } else {
        acc[vi.item_id] = { vi, count: 1, totalStock: vi.stock };
      }
    }
    return Object.values(acc).sort((a, b) => a.vi.item.name.localeCompare(b.vi.item.name));
  }, [vendorItems]);

  const stackedSell = useMemo(() => {
    const acc: Record<string, { inv: InventoryItem; count: number }> = {};
    for (const inv of sellableItems) {
      if (acc[inv.item_id]) acc[inv.item_id].count += 1;
      else acc[inv.item_id] = { inv, count: 1 };
    }
    return Object.values(acc).sort((a, b) => a.inv.item.name.localeCompare(b.inv.item.name));
  }, [sellableItems]);

  const selectedBuy = stackedBuy.find(s => s.vi.id === selectedBuyId) ?? null;
  const selectedSell = stackedSell.find(s => s.inv.id === selectedSellId) ?? null;

  const buyItem = async (vi: VendorItem) => {
    const finalPrice = getDiscountedPrice(vi.price);
    if (gold < finalPrice) {
      addLog('❌ Not enough gold!');
      return;
    }
    const { error } = await supabase.rpc('buy_vendor_item' as any, {
      p_character_id: characterId,
      p_vendor_item_id: vi.id,
    });
    if (error) { addLog(`❌ ${error.message}`); return; }

    const newGold = gold - finalPrice;
    onGoldChange(newGold);
    onInventoryChange();
    const discountNote = buyDiscount > 0 ? ` (${Math.round(buyDiscount * 100)}% CHA discount)` : '';
    addLog(`🪙 Purchased ${vi.item.name} for ${finalPrice} gold.${discountNote}`);

    if (vi.stock > 0) {
      setVendorItems(prev => prev.map(v => v.id === vi.id ? { ...v, stock: v.stock - 1 } : v).filter(v => v.stock !== 0));
    }
  };

  const sellItem = async (inv: InventoryItem) => {
    const { data: sellPrice, error } = await supabase.rpc('sell_item' as any, {
      p_character_id: characterId,
      p_inventory_id: inv.id,
    });
    if (error) { addLog(`❌ ${error.message}`); return; }
    const actualPrice = sellPrice as number;
    onGoldChange(gold + actualPrice);
    onInventoryChange();
    const chaNote = chaMod > 0 ? ` (CHA bonus)` : '';
    addLog(`🪙 Sold ${inv.item.name} for ${actualPrice} gold.${chaNote}`);
    setSelectedSellId(null);
  };

  // ── Slot content ──────────────────────────────────────────────

  const buyList = stackedBuy.length === 0 ? (
    <ServicePanelEmpty>This vendor has nothing for sale.</ServicePanelEmpty>
  ) : (
    <div className="space-y-1.5">
      {stackedBuy.map(({ vi, count, totalStock }) => {
        const selected = vi.id === selectedBuyId;
        return (
          <button
            key={vi.id}
            type="button"
            onClick={() => setSelectedBuyId(selected ? null : vi.id)}
            className={`w-full text-left flex items-center justify-between p-2 rounded border transition-colors ${
              selected ? 'border-primary bg-primary/10' : 'border-border bg-background/40 hover:bg-background/60'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {count > 1 && (
                <span className="text-[10px] font-display bg-primary/20 text-primary rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                  {count}
                </span>
              )}
              <div className="min-w-0">
                <span className={`text-sm font-display ${getItemColor(vi.item)} block truncate`}>{vi.item.name}</span>
                <span className="text-[10px] text-muted-foreground">{vi.item.slot || vi.item.item_type}</span>
                {totalStock > 0 && <span className="text-[10px] text-muted-foreground ml-1">(×{totalStock})</span>}
              </div>
            </div>
            <span className="text-xs font-display text-primary shrink-0 ml-1 flex items-center gap-1">
              <Coins className="w-3 h-3" />
              {buyDiscount > 0 ? (
                <><span className="line-through text-muted-foreground mr-0.5">{vi.price}</span>{getDiscountedPrice(vi.price)}g</>
              ) : <>{vi.price}g</>}
            </span>
          </button>
        );
      })}
    </div>
  );

  const sellList = stackedSell.length === 0 ? (
    <ServicePanelEmpty>No items to sell.</ServicePanelEmpty>
  ) : (
    <div className="space-y-1.5">
      {stackedSell.map(({ inv, count }) => {
        const selected = inv.id === selectedSellId;
        return (
          <button
            key={inv.id}
            type="button"
            onClick={() => setSelectedSellId(selected ? null : inv.id)}
            className={`w-full text-left flex items-center justify-between p-2 rounded border transition-colors ${
              selected ? 'border-primary bg-primary/10' : 'border-border bg-background/40 hover:bg-background/60'
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {count > 1 && (
                <span className="text-[10px] font-display bg-primary/20 text-primary rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                  {count}
                </span>
              )}
              <div className="min-w-0">
                <span className={`text-sm font-display ${getItemColor(inv.item)} block truncate`}>{inv.item.name}</span>
                <span className="text-[10px] text-muted-foreground">{inv.item.slot || inv.item.item_type}</span>
              </div>
            </div>
            <span className="text-xs font-display text-elvish shrink-0 ml-1">{getSellPrice(inv)}g</span>
          </button>
        );
      })}
    </div>
  );

  const buyDetail = selectedBuy ? (
    <div className="space-y-2">
      <h4 className={`font-display text-base ${getItemColor(selectedBuy.vi.item)}`}>{selectedBuy.vi.item.name}</h4>
      <p className="text-[10px] text-muted-foreground capitalize">
        {selectedBuy.vi.item.slot || selectedBuy.vi.item.item_type}
        {selectedBuy.totalStock > 0 && <> · stock ×{selectedBuy.totalStock}</>}
      </p>
      {selectedBuy.vi.item.description && (
        <p className="text-xs text-muted-foreground">{selectedBuy.vi.item.description}</p>
      )}
      {statSummary(selectedBuy.vi.item.stats) && (
        <p className="text-xs text-elvish">{statSummary(selectedBuy.vi.item.stats)}</p>
      )}
      <div className="text-xs text-muted-foreground border-t border-border pt-2">
        Base price: <span className="text-foreground">{selectedBuy.vi.price}g</span>
        {buyDiscount > 0 && (
          <> · You pay: <span className="text-primary font-display">{getDiscountedPrice(selectedBuy.vi.price)}g</span></>
        )}
      </div>
    </div>
  ) : (
    <ServicePanelEmpty>Select an item from the vendor's stock to see details.</ServicePanelEmpty>
  );

  const sellDetail = selectedSell ? (
    <div className="space-y-2">
      <h4 className={`font-display text-base ${getItemColor(selectedSell.inv.item)}`}>{selectedSell.inv.item.name}</h4>
      <p className="text-[10px] text-muted-foreground capitalize">
        {selectedSell.inv.item.slot || selectedSell.inv.item.item_type}
        {selectedSell.count > 1 && <> · ×{selectedSell.count} in stack</>}
      </p>
      {statSummary(selectedSell.inv.item.stats) && (
        <p className="text-xs text-elvish">{statSummary(selectedSell.inv.item.stats)}</p>
      )}
      <div className="text-xs text-muted-foreground border-t border-border pt-2">
        Base value: <span className="text-foreground">{selectedSell.inv.item.value}g</span>
        {chaMod > 0 && (
          <> · CHA bonus: <span className="text-elvish">×{sellMultiplier.toFixed(2)}</span></>
        )}
        <> · Vendor pays: <span className="text-elvish font-display">{getSellPrice(selectedSell.inv)}g</span></>
      </div>
    </div>
  ) : (
    <ServicePanelEmpty>Select an inventory item to see its sell value.</ServicePanelEmpty>
  );

  // ── Render ────────────────────────────────────────────────────

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      <Coins className="w-3 h-3 text-primary" />
      <span className="font-display text-primary">{gold} Gold</span>
      {chaMod > 0 && (
        <span className="text-[10px] text-muted-foreground">
          (CHA: Buy −{Math.round(buyDiscount * 100)}%, Sell {Math.round(sellMultiplier * 100)}%)
        </span>
      )}
    </span>
  );

  const tabs = (
    <Tabs value={tab} onValueChange={v => setTab(v as 'buy' | 'sell')} className="w-full">
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="buy" className="font-display text-xs">🪙 Buy</TabsTrigger>
        <TabsTrigger value="sell" className="font-display text-xs">📦 Sell</TabsTrigger>
      </TabsList>
      <TabsContent value="buy" className="hidden" />
      <TabsContent value="sell" className="hidden" />
    </Tabs>
  );

  const left = tab === 'buy' ? buyList : sellList;
  const right = tab === 'buy' ? buyDetail : sellDetail;

  const footer = tab === 'buy' ? (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {selectedBuy ? <>Buying <span className={getItemColor(selectedBuy.vi.item)}>{selectedBuy.vi.item.name}</span></> : 'Select an item to buy.'}
      </span>
      <Button
        size="sm"
        onClick={() => selectedBuy && buyItem(selectedBuy.vi)}
        disabled={!selectedBuy || gold < (selectedBuy ? getDiscountedPrice(selectedBuy.vi.price) : Infinity)}
        className="font-display text-xs h-8"
      >
        <Coins className="w-3 h-3 mr-1" />
        Buy{selectedBuy ? ` (${getDiscountedPrice(selectedBuy.vi.price)}g)` : ''}
      </Button>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">
        {selectedSell ? <>Selling <span className={getItemColor(selectedSell.inv.item)}>{selectedSell.inv.item.name}</span></> : 'Select an item to sell.'}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => selectedSell && sellItem(selectedSell.inv)}
        disabled={!selectedSell}
        className="font-display text-xs h-8"
      >
        <ArrowUpFromLine className="w-3 h-3 mr-1" />
        Sell{selectedSell ? ` (${getSellPrice(selectedSell.inv)}g)` : ''}
      </Button>
    </div>
  );

  return (
    <ServicePanelShell
      open={open}
      onClose={onClose}
      icon="🪙"
      title="Vendor"
      subtitle={subtitle}
      tabs={tabs}
      leftTitle={tab === 'buy' ? 'For Sale' : 'Your Inventory'}
      rightTitle="Details"
      left={left}
      right={right}
      footer={footer}
    />
  );
}
