/**
 * items.ts — Item stat budget, cost, caps, repair, suggested gold value.
 *
 * Mirror of `src/shared/formulas/items.ts`. Keep both in sync.
 * Late-game compression: soft taper above L30, primary-cap taper at L28+,
 * +1 budget point for uncommon hybrids at L30+, and unique 2H mult reduced
 * from 1.5 → 1.35.
 */

export const ITEM_RARITY_MULTIPLIER: Record<string, number> = {
  common: 1.0, uncommon: 1.5, soulforged: 2.0, unique: 3.0,
};

export const ITEM_STAT_COSTS: Record<string, number> = {
  str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1,
  ac: 3, hp: 0.5, hp_regen: 2,
};

export const ITEM_STAT_CAPS: Record<string, number> = {
  str: 5, dex: 5, con: 5, int: 5, wis: 5, cha: 5,
  ac: 3, hp: 10, hp_regen: 3,
};

export const CONSUMABLE_ALLOWED_STATS = ['hp', 'hp_regen'];

export function getItemHandsMultiplier(rarity: string, hands: number): number {
  if (hands !== 2) return 1.0;
  return rarity === 'unique' ? 1.35 : 1.5;
}

export function getItemLevelTaper(level: number): number {
  if (level <= 30) return 1.0;
  if (level <= 35) return 0.90;
  if (level <= 40) return 0.80;
  return 0.72;
}

export function getItemStatBudget(level: number, rarity: string, hands: number = 1, itemType: string = 'equipment'): number {
  const mult = ITEM_RARITY_MULTIPLIER[rarity] || 1;
  const handsMult = getItemHandsMultiplier(rarity, hands);
  // Consumables skip the late-game taper so potions keep scaling past L29.
  if (itemType === 'consumable') {
    const rawC = 2 + (level - 1) * 0.24 * mult * handsMult;
    return Math.max(2, Math.floor(rawC)) * 3;
  }
  // Soulforged items skip the late-game taper so tiered upgrades
  // (Soulforged Ring at L30/33/36/39/42) keep growing in budget.
  const taper = rarity === 'soulforged' ? 1.0 : getItemLevelTaper(level);
  // Slope 0.24 = squish v2 (−20% per-level growth, applied 2026-05).
  const raw = 2 + (level - 1) * 0.24 * mult * handsMult;
  const hybridBonus = rarity === 'uncommon' && level >= 30 ? 1 : 0;
  return Math.max(2, Math.floor(raw * taper) + hybridBonus);
}

export function calculateItemStatCost(stats: Record<string, number>): number {
  return Object.entries(stats).reduce(
    (sum, [key, val]) => sum + val * (ITEM_STAT_COSTS[key] || 1),
    0,
  );
}

export function getItemStatCap(statKey: string, level: number = 1, itemType: string = 'equipment'): number {
  if (itemType === 'consumable') return 9999;
  if (statKey === 'ac' || statKey === 'hp_regen') {
    return 2 + Math.floor(level / 10);
  }
  if (statKey === 'hp') {
    return 6 + Math.floor(level / 5) * 2;
  }
  if (level <= 28) return 4 + Math.floor(level / 4);
  if (level <= 40) return 11 + Math.floor((level - 28) / 6);
  return 13;
}

export const SINGLE_STAT_BUDGET_RATIO = 0.6;
export function getEffectiveStatCap(
  statKey: string, level: number, budget: number, itemType: string = 'equipment',
): number {
  const baseCap = getItemStatCap(statKey, level, itemType);
  if (itemType === 'consumable') return baseCap;
  const isPrimary = ['str','dex','con','int','wis','cha'].includes(statKey);
  if (!isPrimary) return baseCap;
  const ratioCap = Math.max(1, Math.floor(budget * SINGLE_STAT_BUDGET_RATIO));
  return Math.min(baseCap, ratioCap);
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
  if (mult === 0) return 0;
  return Math.max(1, Math.ceil((100 - currentDurability) * value * mult / 100));
}

// effectiveItemStats — see src/shared/formulas/items.ts for full docs.
const GEM_TO_ATTR: Record<string, string> = {
  garnet: 'str', topaz: 'dex', emerald: 'con',
  sapphire: 'int', pearl: 'wis', amethyst: 'cha',
};

export interface EffectiveStatsInput {
  baseStats?: Record<string, number> | null;
  statOverride?: Record<string, number> | null;
  appliedGems?: Record<string, number> | null;
}

export function effectiveItemStats(input: EffectiveStatsInput): Record<string, number> {
  const base = input.statOverride ?? input.baseStats ?? {};
  const out: Record<string, number> = { ...base };
  const gems = input.appliedGems ?? {};
  for (const [gem, count] of Object.entries(gems)) {
    if (!count || count <= 0) continue;
    const attr = GEM_TO_ATTR[gem];
    if (!attr) continue;
    out[attr] = (out[attr] ?? 0) + count;
  }
  return out;
}

export function effectiveItemLevel(itemLevel: number | null | undefined, craftedLevel?: number | null): number {
  return (craftedLevel ?? itemLevel ?? 1);
}

// Tier helpers — mirror of src/shared/formulas/items.ts (2026-07 overhaul).
export const GEAR_TIERS = [
  { tier: 1, prefix: 'Worn',     unlockLevel: 1,  itemLevel: 1 },
  { tier: 2, prefix: 'Sturdy',   unlockLevel: 10, itemLevel: 11 },
  { tier: 3, prefix: 'Engraved', unlockLevel: 20, itemLevel: 21 },
  { tier: 4, prefix: 'Runed',    unlockLevel: 30, itemLevel: 31 },
  { tier: 5, prefix: 'Ancient',  unlockLevel: 40, itemLevel: 41 },
] as const;

export function getCraftableTierForLevel(playerLevel: number): number {
  let t = 1;
  for (const row of GEAR_TIERS) if (playerLevel >= row.unlockLevel) t = row.tier;
  return t;
}

export function getCraftedLevelForTier(tier: number): number {
  return GEAR_TIERS.find(r => r.tier === tier)?.itemLevel ?? 1;
}


