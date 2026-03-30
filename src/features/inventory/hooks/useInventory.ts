import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  belt_slot: number | null;
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
    is_soulbound?: boolean;
    weapon_tag?: string | null;
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
      .eq('character_id', characterId)
      .order('created_at', { ascending: true });
    if (data) setInventory(data as unknown as InventoryItem[]);
    setLoading(false);
  }, [characterId]);

  useEffect(() => {
    fetchInventory();
    // No realtime subscription — every inventory mutation already calls fetchInventory()
  }, [characterId, fetchInventory]);

  const equipItem = useCallback(async (inventoryId: string, slot: string) => {
    if (!characterId) return;
    const itemToEquip = inventory.find(i => i.id === inventoryId);
    // Prevent equipping broken items
    if (itemToEquip && itemToEquip.current_durability <= 0) return;
    
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
    // If unequipping a belt, clear all belt_slot assignments
    const item = inventory.find(i => i.id === inventoryId);
    if (item?.equipped_slot === 'belt') {
      const beltedIds = inventory.filter(i => i.belt_slot !== null && i.belt_slot !== undefined).map(i => i.id);
      if (beltedIds.length > 0) {
        await Promise.all(beltedIds.map(id =>
          supabase.from('character_inventory').update({ belt_slot: null } as any).eq('id', id)
        ));
      }
    }
    await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', inventoryId);
    fetchInventory();
  }, [inventory, fetchInventory]);

  const dropItem = useCallback(async (inventoryId: string) => {
    const item = inventory.find(i => i.id === inventoryId);
    if (item?.item.is_soulbound) return; // Cannot drop soulbound items
    await supabase.from('character_inventory').delete().eq('id', inventoryId);
    fetchInventory();
  }, [inventory, fetchInventory]);

  const useConsumable = useCallback(async (inventoryId: string, _characterId: string, currentHp: number, maxHp: number, updateCharacter: (updates: { hp: number }) => Promise<void>) => {
    const inv = inventory.find(i => i.id === inventoryId);
    if (!inv || inv.item.item_type !== 'consumable') return null;
    const hpRestore = (inv.item.stats?.hp as number) || 0;
    const hpRegen = (inv.item.stats?.hp_regen as number) || 0;
    if (hpRestore <= 0 && hpRegen <= 0) return null;
    if (hpRestore > 0) {
      const newHp = Math.min(currentHp + hpRestore, maxHp);
      await updateCharacter({ hp: newHp });
    }
    await supabase.from('character_inventory').delete().eq('id', inventoryId);
    fetchInventory();
    return { restored: hpRestore > 0 ? Math.min(hpRestore, maxHp - currentHp) : 0, itemName: inv.item.name, hpRegen, isPotion: hpRestore > 0 };
  }, [inventory, fetchInventory]);

  const equipped = inventory.filter(i => i.equipped_slot);
  const unequipped = inventory.filter(i => !i.equipped_slot);

  // Calculate total stat bonuses from equipped items
  const equipmentBonuses = equipped.filter(i => i.current_durability > 0).reduce((acc, item) => {
    const stats = item.item.stats || {};
    for (const [key, val] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (val as number);
    }
    return acc;
  }, {} as Record<string, number>);

  // Belt potion system
  const equippedBelt = equipped.find(i => i.equipped_slot === 'belt');
  const beltCapacity = equippedBelt
    ? ((equippedBelt.item.stats?.potion_slots as number) ?? 0)
    : 0;
  const beltedPotions = inventory.filter(i => i.belt_slot !== null && i.belt_slot !== undefined);

  const beltPotion = useCallback(async (inventoryId: string) => {
    if (!characterId || beltCapacity <= 0) return;
    const item = inventory.find(i => i.id === inventoryId);
    if (item && item.current_durability <= 0) return;
    // Find the next open slot
    const usedSlots = new Set(beltedPotions.map(i => i.belt_slot));
    let openSlot: number | null = null;
    for (let s = 1; s <= beltCapacity; s++) {
      if (!usedSlots.has(s)) { openSlot = s; break; }
    }
    if (openSlot === null) return;
    await supabase.from('character_inventory').update({ belt_slot: openSlot } as any).eq('id', inventoryId);
    fetchInventory();
  }, [characterId, beltCapacity, beltedPotions, fetchInventory]);

  const unbeltPotion = useCallback(async (inventoryId: string) => {
    await supabase.from('character_inventory').update({ belt_slot: null } as any).eq('id', inventoryId);
    fetchInventory();
  }, [fetchInventory]);

  return { inventory, equipped, unequipped, equipmentBonuses, loading, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, beltedPotions, beltCapacity, beltPotion, unbeltPotion };
}
