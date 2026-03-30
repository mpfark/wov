// Inventory feature — hooks and types for inventory, items, and ground loot

export { useInventory } from './hooks/useInventory';
export type { InventoryItem } from './hooks/useInventory';
export { useItemCache, getCachedItemAsync } from './hooks/useItemCache';
export type { CachedItem } from './hooks/useItemCache';
export { useGroundLoot } from './hooks/useGroundLoot';
export type { GroundLootItem } from './hooks/useGroundLoot';

// Consumable action orchestration hook
export { useConsumableActions } from './hooks/useConsumableActions';
export type { UseConsumableActionsParams } from './hooks/useConsumableActions';
