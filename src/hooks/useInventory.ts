import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  item: {
    id: string;
    name: string;
    description: string;
    item_type: string;
    rarity: string;
    slot: string | null;
    stats: Record<string, number>;
    value: number;
    max_durability: number;
    hands: number | null;
  };
}

export function useInventory(characterId: string | null) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchInventory = useCallback(async () => {
    if (!characterId) { setInventory([]); return; }
    setLoading(true);
    const { data } = await supabase
      .from('character_inventory')
      .select('*, item:items(*)')
      .eq('character_id', characterId);
    if (data) setInventory(data as unknown as InventoryItem[]);
    setLoading(false);
  }, [characterId]);

  useEffect(() => {
    fetchInventory();

    if (!characterId) return;
    const channel = supabase
      .channel(`inventory-${characterId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'character_inventory',
        filter: `character_id=eq.${characterId}`,
      }, () => fetchInventory())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [characterId, fetchInventory]);

  const equipItem = useCallback(async (inventoryId: string, slot: string) => {
    if (!characterId) return;
    const itemToEquip = inventory.find(i => i.id === inventoryId);
    
    // If equipping a 2h weapon to main_hand, also unequip off_hand
    if (itemToEquip && slot === 'main_hand' && itemToEquip.item.hands === 2) {
      const offHand = inventory.find(i => i.equipped_slot === 'off_hand');
      if (offHand) {
        await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', offHand.id);
      }
    }
    // Prevent equipping off_hand if main_hand has a 2h weapon
    if (slot === 'off_hand') {
      const mainHand = inventory.find(i => i.equipped_slot === 'main_hand');
      if (mainHand && mainHand.item.hands === 2) return;
    }
    // Unequip anything in that slot first
    const existing = inventory.find(i => i.equipped_slot === slot);
    if (existing) {
      await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', existing.id);
    }
    await supabase.from('character_inventory').update({ equipped_slot: slot as any }).eq('id', inventoryId);
    fetchInventory();
  }, [characterId, inventory, fetchInventory]);

  const unequipItem = useCallback(async (inventoryId: string) => {
    await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', inventoryId);
    fetchInventory();
  }, [fetchInventory]);

  const dropItem = useCallback(async (inventoryId: string) => {
    await supabase.from('character_inventory').delete().eq('id', inventoryId);
    fetchInventory();
  }, [fetchInventory]);

  const useConsumable = useCallback(async (inventoryId: string, characterId: string, currentHp: number, maxHp: number, updateCharacter: (updates: { hp: number }) => Promise<void>) => {
    const inv = inventory.find(i => i.id === inventoryId);
    if (!inv || inv.item.item_type !== 'consumable') return null;
    const hpRestore = (inv.item.stats?.hp as number) || 0;
    if (hpRestore <= 0) return null;
    const newHp = Math.min(currentHp + hpRestore, maxHp);
    await updateCharacter({ hp: newHp });
    await supabase.from('character_inventory').delete().eq('id', inventoryId);
    fetchInventory();
    return { restored: newHp - currentHp, itemName: inv.item.name };
  }, [inventory, fetchInventory]);

  const equipped = inventory.filter(i => i.equipped_slot);
  const unequipped = inventory.filter(i => !i.equipped_slot);

  // Calculate total stat bonuses from equipped items
  const equipmentBonuses = equipped.reduce((acc, item) => {
    const stats = item.item.stats || {};
    for (const [key, val] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (val as number);
    }
    return acc;
  }, {} as Record<string, number>);

  return { inventory, equipped, unequipped, equipmentBonuses, loading, fetchInventory, equipItem, unequipItem, dropItem, useConsumable };
}
