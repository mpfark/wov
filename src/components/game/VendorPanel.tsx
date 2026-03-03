import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Coins, ShoppingBag, ArrowUpFromLine } from 'lucide-react';
import { InventoryItem } from '@/hooks/useInventory';

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

export default function VendorPanel({ open, onClose, nodeId, characterId, gold, inventory, onGoldChange, onInventoryChange, addLog }: Props) {
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

  const buyItem = async (vi: VendorItem) => {
    if (gold < vi.price) {
      addLog('❌ Not enough gold!');
      return;
    }
    const { error } = await supabase.from('character_inventory').insert({
      character_id: characterId,
      item_id: vi.item_id,
      current_durability: 100,
    });
    if (error) { addLog(`❌ ${error.message}`); return; }

    const newGold = gold - vi.price;
    await supabase.from('characters').update({ gold: newGold }).eq('id', characterId);
    onGoldChange(newGold);
    onInventoryChange();
    addLog(`🪙 Purchased ${vi.item.name} for ${vi.price} gold.`);

    if (vi.stock > 0) {
      await supabase.from('vendor_inventory').update({ stock: vi.stock - 1 }).eq('id', vi.id);
      setVendorItems(prev => prev.map(v => v.id === vi.id ? { ...v, stock: v.stock - 1 } : v).filter(v => v.stock !== 0));
    }
  };

  const sellItem = async (inv: InventoryItem) => {
    const sellPrice = Math.max(1, Math.floor(inv.item.value * 0.5));
    await supabase.from('character_inventory').delete().eq('id', inv.id);
    const newGold = gold + sellPrice;
    await supabase.from('characters').update({ gold: newGold }).eq('id', characterId);
    onGoldChange(newGold);
    onInventoryChange();
    addLog(`🪙 Sold ${inv.item.name} for ${sellPrice} gold.`);
  };

  const sellableItems = inventory.filter(i => !i.equipped_slot);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="font-display text-primary text-glow flex items-center gap-2">
            <ShoppingBag className="w-5 h-5" /> Vendor
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 text-sm mb-3">
          <Coins className="w-4 h-4 text-primary" />
          <span className="font-display text-primary">{gold} Gold</span>
        </div>

        {/* Buy */}
        <div className="space-y-2">
          <h3 className="font-display text-xs text-muted-foreground">For Sale</h3>
        {vendorItems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">This vendor has nothing for sale.</p>
          ) : (() => {
            // Stack vendor items by item_id
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
                <div className="flex items-center gap-1.5">
                  {count > 1 && (
                    <span className="text-[10px] font-display bg-primary/20 text-primary rounded-full w-5 h-5 flex items-center justify-center">
                      {count}
                    </span>
                  )}
                  <div>
                    <span className={`text-sm font-display ${RARITY_COLORS[vi.item.rarity] || ''}`}>{vi.item.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{vi.item.slot || vi.item.item_type}</span>
                    {totalStock > 0 && <span className="text-xs text-muted-foreground ml-1">(×{totalStock})</span>}
                  </div>
                </div>
                <Button size="sm" onClick={() => buyItem(vi)} disabled={gold < vi.price}
                  className="font-display text-xs h-7">
                  <Coins className="w-3 h-3 mr-1" /> {vi.price}g
                </Button>
              </div>
            ));
          })()}
        </div>

        {/* Sell */}
        <div className="space-y-2 mt-4 border-t border-border pt-3">
          <h3 className="font-display text-xs text-muted-foreground">Sell Items</h3>
          {sellableItems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No items to sell.</p>
          ) : (() => {
            const stacked = sellableItems.reduce<Record<string, { inv: InventoryItem; count: number }>>((acc, inv) => {
              if (acc[inv.item_id]) {
                acc[inv.item_id].count += 1;
              } else {
                acc[inv.item_id] = { inv, count: 1 };
              }
              return acc;
            }, {});
            const sellPrice = (inv: InventoryItem) => Math.max(1, Math.floor(inv.item.value * 0.5));
            return Object.values(stacked).sort((a, b) => a.inv.item.name.localeCompare(b.inv.item.name)).map(({ inv, count }) => (
              <div key={inv.item_id} className="flex items-center justify-between p-2 rounded border border-border bg-background/40">
                <div className="flex items-center gap-1.5">
                  {count > 1 && (
                    <span className="text-[10px] font-display bg-primary/20 text-primary rounded-full w-5 h-5 flex items-center justify-center">
                      {count}
                    </span>
                  )}
                  <div>
                    <span className={`text-sm font-display ${RARITY_COLORS[inv.item.rarity] || ''}`}>{inv.item.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{inv.item.slot || inv.item.item_type}</span>
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => sellItem(inv)} className="font-display text-xs h-7">
                  <ArrowUpFromLine className="w-3 h-3 mr-1" /> {sellPrice(inv)}g
                </Button>
              </div>
            ));
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
