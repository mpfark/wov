import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  is_pinned: boolean;
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
    appearance_key?: string | null;
    illustration_url?: string | null;
    level?: number | null;
    procs?: any;
  };
}

interface UseInventoryOptions {
  onResourcesSynced?: () => void;
}

/** Slots that accept any item whose item.slot === 'ring'. */
const RING_SLOTS = ['ring', 'ring_2'] as const;

export function useInventory(characterId: string | null, options: UseInventoryOptions = {}) {
  const { onResourcesSynced } = options;
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
  }, [characterId, fetchInventory]);

  const syncResources = useCallback(async () => {
    if (!characterId) return;
    try {
      await supabase.rpc('sync_character_resources' as any, { p_character_id: characterId });
      onResourcesSynced?.();
    } catch (e) {
      console.error('Failed to sync character resources after gear change:', e);
    }
  }, [characterId, onResourcesSynced]);

  const equipItem = useCallback(async (inventoryId: string, slot: string) => {
    if (!characterId) return;
    const itemToEquip = inventory.find(i => i.id === inventoryId);
    if (itemToEquip && itemToEquip.current_durability <= 0) return;

    // Rings: item.slot === 'ring' but can occupy 'ring' or 'ring_2'.
    // If caller passed the generic 'ring' slot, auto-pick the first open ring slot
    // (so equipping a second ring fills ring_2 instead of replacing ring).
    // Explicit 'ring_2' is always respected.
    let targetSlot = slot;
    if (itemToEquip?.item.slot === 'ring' && targetSlot !== 'ring_2') {
      const ring1Taken = inventory.some(i => i.equipped_slot === 'ring');
      const ring2Taken = inventory.some(i => i.equipped_slot === 'ring_2');
      targetSlot = !ring1Taken ? 'ring' : !ring2Taken ? 'ring_2' : 'ring';
    }

    if (itemToEquip && targetSlot === 'main_hand' && itemToEquip.item.hands === 2) {
      const offHand = inventory.find(i => i.equipped_slot === 'off_hand');
      if (offHand) {
        await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', offHand.id);
      }
    }
    if (targetSlot === 'off_hand') {
      const mainHand = inventory.find(i => i.equipped_slot === 'main_hand');
      if (mainHand && mainHand.item.hands === 2) return;
    }
    const existing = inventory.find(i => i.equipped_slot === targetSlot);
    if (existing) {
      await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', existing.id);
    }
    await supabase.from('character_inventory').update({ equipped_slot: targetSlot as any }).eq('id', inventoryId);
    await syncResources();
    fetchInventory();
  }, [characterId, inventory, fetchInventory, syncResources]);

  const unequipItem = useCallback(async (inventoryId: string) => {
    await supabase.from('character_inventory').update({ equipped_slot: null }).eq('id', inventoryId);
    await syncResources();
    fetchInventory();
  }, [fetchInventory, syncResources]);

  const dropItem = useCallback(async (inventoryId: string) => {
    const item = inventory.find(i => i.id === inventoryId);
    if (item?.item.is_soulbound) return;
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

  const equipmentBonuses = equipped.filter(i => i.current_durability > 0).reduce((acc, item) => {
    const stats = item.item.stats || {};
    for (const [key, val] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (val as number);
    }
    return acc;
  }, {} as Record<string, number>);

  const togglePin = useCallback(async (inventoryId: string) => {
    const item = inventory.find(i => i.id === inventoryId);
    if (!item) return;
    await supabase.from('character_inventory').update({ is_pinned: !item.is_pinned }).eq('id', inventoryId);
    fetchInventory();
  }, [inventory, fetchInventory]);

  return { inventory, equipped, unequipped, equipmentBonuses, loading, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, togglePin };
}
