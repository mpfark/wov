import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { effectiveItemStats } from '@/shared/formulas/items';

export interface InventoryItem {
  id: string;
  character_id: string;
  item_id: string;
  equipped_slot: string | null;
  current_durability: number;
  is_pinned: boolean;
  /** Per-instance gem upgrades — gem key → count. See effectiveItemStats(). */
  applied_gems?: Record<string, number> | null;
  /** When present, replaces items.stats as the base for effective stats. */
  stat_override?: Record<string, number> | null;
  /** Per-instance crafted level for stat budget/cap calc. */
  crafted_level?: number | null;
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
    map_target_node_id?: string | null;
    map_region_id?: string | null;
    map_flavor?: string | null;
  };
}

/** Effective stats for an inventory instance (base + stat_override + applied_gems). */
export function getEffectiveStats(inv: Pick<InventoryItem, 'applied_gems' | 'stat_override' | 'item'>): Record<string, number> {
  return effectiveItemStats({
    baseStats: inv.item?.stats,
    statOverride: inv.stat_override,
    appliedGems: inv.applied_gems,
  });
}

interface UseInventoryOptions {
  onResourcesSynced?: () => void;
}


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

  useEffect(() => {
    const handler = () => { fetchInventory(); };
    window.addEventListener('inventory:changed', handler);
    return () => window.removeEventListener('inventory:changed', handler);
  }, [fetchInventory]);

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

    if (targetSlot === 'off_hand') {
      const mainHand = inventory.find(i => i.equipped_slot === 'main_hand');
      if (mainHand && mainHand.item.hands === 2) return;
    }
    const { data } = await supabase.rpc('character_inventory_action' as never, {
      _character_id: characterId, _action: 'equip', _inventory_id: inventoryId,
      _slot: targetSlot, _request_id: crypto.randomUUID(),
    } as never);
    if (!(data as { ok?: boolean } | null)?.ok) return;
    await syncResources();
    fetchInventory();
  }, [characterId, inventory, fetchInventory, syncResources]);

  const unequipItem = useCallback(async (inventoryId: string) => {
    if (!characterId) return;
    const { data } = await supabase.rpc('character_inventory_action' as never, {
      _character_id: characterId, _action: 'unequip', _inventory_id: inventoryId,
      _slot: null, _request_id: crypto.randomUUID(),
    } as never);
    if (!(data as { ok?: boolean } | null)?.ok) return;
    await syncResources();
    fetchInventory();
  }, [characterId, fetchInventory, syncResources]);

  const dropItem = useCallback(async (inventoryId: string) => {
    if (!characterId) return;
    const item = inventory.find(i => i.id === inventoryId);
    if (item?.item.is_soulbound) return;
    const { data } = await supabase.rpc('character_inventory_action' as never, {
      _character_id: characterId, _action: 'drop', _inventory_id: inventoryId,
      _slot: null, _request_id: crypto.randomUUID(),
    } as never);
    if (!(data as { ok?: boolean } | null)?.ok) return;
    fetchInventory();
  }, [characterId, inventory, fetchInventory]);

  const useConsumable = useCallback(async (inventoryId: string, _characterId: string, _currentHp: number, _maxHp: number, _updateCharacter: (updates: { hp: number }) => Promise<void>) => {
    if (!characterId) return null;
    const inv = inventory.find(i => i.id === inventoryId);
    if (!inv || inv.item.item_type !== 'consumable') return null;
    const { data } = await supabase.rpc('character_inventory_action' as never, {
      _character_id: characterId, _action: 'consume', _inventory_id: inventoryId,
      _slot: null, _request_id: crypto.randomUUID(),
    } as never);
    const result = data as { ok?: boolean; restored?: number; item_name?: string; hp_regen?: number } | null;
    if (!result?.ok) return null;
    fetchInventory();
    return { restored: result.restored ?? 0, itemName: result.item_name ?? inv.item.name, hpRegen: result.hp_regen ?? 0, isPotion: (result.restored ?? 0) > 0 };
  }, [characterId, inventory, fetchInventory]);

  const equipped = inventory.filter(i => i.equipped_slot);
  const unequipped = inventory.filter(i => !i.equipped_slot);

  const equipmentBonuses = equipped.filter(i => i.current_durability > 0).reduce((acc, inv) => {
    // Effective stats = (stat_override ?? items.stats) + applied_gems → attrs.
    // Player-applied gem upgrades must be counted exactly once here so the
    // character panel and any downstream consumer of equipmentBonuses see them.
    const stats = getEffectiveStats(inv);
    for (const [key, val] of Object.entries(stats)) {
      acc[key] = (acc[key] || 0) + (val as number);
    }
    return acc;
  }, {} as Record<string, number>);

  const togglePin = useCallback(async (inventoryId: string) => {
    if (!characterId) return;
    const item = inventory.find(i => i.id === inventoryId);
    if (!item) return;
    const { data } = await supabase.rpc('character_inventory_action' as never, {
      _character_id: characterId, _action: 'pin', _inventory_id: inventoryId,
      _slot: null, _request_id: crypto.randomUUID(),
    } as never);
    if (!(data as { ok?: boolean } | null)?.ok) return;
    fetchInventory();
  }, [characterId, inventory, fetchInventory]);

  return { inventory, equipped, unequipped, equipmentBonuses, loading, fetchInventory, equipItem, unequipItem, dropItem, useConsumable, togglePin };
}
