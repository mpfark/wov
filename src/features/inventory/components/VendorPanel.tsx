import { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/dialog';
import ScrollPanel from './ScrollPanel';
import { Button } from '@/components/ui/button';
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
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-foreground',
  uncommon: 'text-elvish',
  unique: 'text-primary text-glow',
  soulforged: 'text-soulforged text-glow-soulforged',
};

const getItemColor = (item: { rarity: string; is_soulbound?: boolean }) =>
  item.is_soulbound ? 'text-soulforged text-glow-soulforged' : (RARITY_COLORS[item.rarity] || '');

export default function VendorPanel({ open, onClose, nodeId, characterId, gold, cha, equipmentBonuses = {}, inventory, onGoldChange, onInventoryChange, addLog }: Props) {
  const effectiveCha = cha + (equipmentBonuses.cha || 0);
  const buyDiscount = getChaBuyDiscount(effectiveCha);
  const sellMultiplier = getChaSellMultiplier(effectiveCha);
  const chaMod = getStatModifier(effectiveCha);
  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);

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

  const getSellPrice = (inv: InventoryItem) => Math.max(1, Math.floor(inv.item.value * sellMultiplier));

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
  };

  const sellableItems = inventory.filter(i => !i.equipped_slot && !i.item.is_soulbound && !i.is_pinned);

  const renderBuyColumn = () => {
    if (vendorItems.length === 0) {
      return <p className="text-xs text-muted-foreground italic">This vendor has nothing for sale.</p>;
    }
    const stacked = vendorItems.reduce<Record<string, { vi: VendorItem; count: number; totalStock: number }>>((acc, vi) => {
      if (acc[vi.item_id]) {
        acc[vi.item_id].count += 1;
        acc[vi.item_id].totalStock += vi.stock;
      } else {
        acc[vi.item_id] = { vi, count: 1, totalStock: vi.stock };
      }
      return acc;
    }, {});
    return Object.values(stacked).sort((a, b) => a.vi.item.name.localeCompare(b.vi.item.name)).map(({ vi, count, totalStock }) => (
      <div key={vi.item_id} className="flex items-center justify-between p-2 rounded border border-border bg-background/40">
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
        <Button size="sm" onClick={() => buyItem(vi)} disabled={gold < getDiscountedPrice(vi.price)}
          className="font-display text-xs h-7 shrink-0 ml-1">
          <Coins className="w-3 h-3 mr-1" />
          {buyDiscount > 0 ? <><span className="line-through text-muted-foreground mr-0.5">{vi.price}</span>{getDiscountedPrice(vi.price)}g</> : <>{vi.price}g</>}
        </Button>
      </div>
    ));
  };

  const renderSellColumn = () => {
    if (sellableItems.length === 0) {
      return <p className="text-xs text-muted-foreground italic">No items to sell.</p>;
    }
    const stacked = sellableItems.reduce<Record<string, { inv: InventoryItem; count: number }>>((acc, inv) => {
      if (acc[inv.item_id]) {
        acc[inv.item_id].count += 1;
      } else {
        acc[inv.item_id] = { inv, count: 1 };
      }
      return acc;
    }, {});
    return Object.values(stacked).sort((a, b) => a.inv.item.name.localeCompare(b.inv.item.name)).map(({ inv, count }) => (
      <div key={inv.item_id} className="flex items-center justify-between p-2 rounded border border-border bg-background/40">
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
        <Button size="sm" variant="outline" onClick={() => sellItem(inv)} className="font-display text-xs h-7 shrink-0 ml-1">
          <ArrowUpFromLine className="w-3 h-3 mr-1" /> {getSellPrice(inv)}g
        </Button>
      </div>
    ));
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <ScrollPanel icon="🪙" title="Vendor" wide>

        <div className="flex items-center gap-2 text-sm mb-3">
          <Coins className="w-4 h-4 text-primary" />
          <span className="font-display text-primary">{gold} Gold</span>
          {chaMod > 0 && <span className="text-[10px] text-muted-foreground">(CHA: Buy -{Math.round(buyDiscount * 100)}%, Sell {Math.round(sellMultiplier * 100)}%)</span>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Buy column */}
          <div className="space-y-2">
            <h3 className="font-display text-xs text-muted-foreground">For Sale</h3>
            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
              {renderBuyColumn()}
            </div>
          </div>

          {/* Sell column */}
          <div className="space-y-2">
            <h3 className="font-display text-xs text-muted-foreground">Your Inventory</h3>
            <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
              {renderSellColumn()}
            </div>
          </div>
        </div>
      </ScrollPanel>
    </Dialog>
  );
}
