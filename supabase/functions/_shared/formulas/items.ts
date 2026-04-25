/**
 * items.ts — Item stat budget, cost, caps, repair, suggested gold value.
 *
 * CANONICAL OWNER for: ITEM_RARITY_MULTIPLIER, ITEM_STAT_COSTS, ITEM_STAT_CAPS,
 * getItemStatBudget, calculateItemStatCost, getItemStatCap, suggestItemGoldValue,
 * calculateRepairCost, CONSUMABLE_ALLOWED_STATS.
 */

export const ITEM_RARITY_MULTIPLIER: Record<string, number> = {
  common: 1.0, uncommon: 1.5, soulforged: 2.0, unique: 3.0,
};

export const ITEM_STAT_COSTS: Record<string, number> = {
  str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1,
  ac: 3, hp: 0.5, hp_regen: 2, potion_slots: 1,
};

export const ITEM_STAT_CAPS: Record<string, number> = {
  str: 5, dex: 5, con: 5, int: 5, wis: 5, cha: 5,
  ac: 3, hp: 10, hp_regen: 3,
};

export const CONSUMABLE_ALLOWED_STATS = ['hp', 'hp_regen'];

export function getItemStatBudget(level: number, rarity: string, hands: number = 1, itemType: string = 'equipment'): number {
  const mult = ITEM_RARITY_MULTIPLIER[rarity] || 1;
  const handsMult = hands === 2 ? 1.5 : 1;
  const base = Math.floor(1 + (level - 1) * 0.3 * mult * handsMult);
  // Consumables get 3x budget since they're single-use
  return itemType === 'consumable' ? base * 3 : base;
}

export function calculateItemStatCost(stats: Record<string, number>): number {
  return Object.entries(stats).reduce(
    (sum, [key, val]) => sum + val * (ITEM_STAT_COSTS[key] || 1),
    0,
  );
}

export function getItemStatCap(statKey: string, level: number = 1, itemType: string = 'equipment'): number {
  if (itemType === 'consumable') return 9999;
  if (statKey === 'potion_slots') return 4;
  if (statKey === 'ac' || statKey === 'hp_regen') {
    return 2 + Math.floor(level / 10);
  }
  if (statKey === 'hp') {
    return 6 + Math.floor(level / 5) * 2;
  }
  return 4 + Math.floor(level / 4);
}

export function suggestItemGoldValue(level: number, rarity: string): number {
  const mult = ITEM_RARITY_MULTIPLIER[rarity] || 1;
  return Math.round(level * 2.5 * mult * mult);
}

const REPAIR_RARITY_MULT: Record<string, number> = {
  common: 1, uncommon: 1.5, unique: 0,
};

export function calculateRepairCost(_maxDurability: number, currentDurability: number, value: number, rarity: string): number {
  const mult = REPAIR_RARITY_MULT[rarity] ?? 1;
  if (mult === 0) return 0; // unique = unrepairable
  // All items have a fixed max durability of 100
  return Math.max(1, Math.ceil((100 - currentDurability) * value * mult / 100));
}
