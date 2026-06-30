/**
 * items.ts — Item stat budget, cost, caps, repair, suggested gold value.
 *
 * CANONICAL OWNER for: ITEM_RARITY_MULTIPLIER, ITEM_STAT_COSTS, ITEM_STAT_CAPS,
 * getItemStatBudget, calculateItemStatCost, getItemStatCap, suggestItemGoldValue,
 * calculateRepairCost, CONSUMABLE_ALLOWED_STATS.
 *
 * Late-game compression (planned + applied 2026-05):
 *   - Soft taper above L30 (90% / 80% / 72%) on all rarities/hands.
 *   - Primary-stat cap tapers from L28 onward and ceilings at 13 at L40+.
 *   - Uncommon hybrids get +1 budget point at L30+ ("hybrid efficiency bonus").
 *   - Unique 2H weapons drop hands_mult 1.5 → 1.35 so the unique×2H curve
 *     (formerly 4.5× a common's budget at the same level) is reined in.
 *
 * Mirrored in `supabase/functions/_shared/formulas/items.ts` and the local
 * helpers inside `supabase/functions/seed-archetype-items` and
 * `supabase/functions/ai-item-forge`. Keep all four in sync.
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

/** Two-handed multiplier. Reduced for unique tier so unique×2H stops being the runaway outlier. */
export function getItemHandsMultiplier(rarity: string, hands: number): number {
  if (hands !== 2) return 1.0;
  return rarity === 'unique' ? 1.35 : 1.5;
}

/** Late-game soft taper. Identity below L30, then 90% / 80% / 72%. */
export function getItemLevelTaper(level: number): number {
  if (level <= 30) return 1.0;
  if (level <= 35) return 0.90;
  if (level <= 40) return 0.80;
  return 0.72;
}

export function getItemStatBudget(level: number, rarity: string, hands: number = 1, itemType: string = 'equipment'): number {
  const mult = ITEM_RARITY_MULTIPLIER[rarity] || 1;
  const handsMult = getItemHandsMultiplier(rarity, hands);
  // Consumables skip the late-game taper/hybrid bonus so potions keep
  // scaling linearly with level past L29 instead of plateauing at 30 points.
  if (itemType === 'consumable') {
    const rawC = 2 + (level - 1) * 0.24 * mult * handsMult;
    return Math.max(2, Math.floor(rawC)) * 3;
  }
  // Soulforged items (player-forged endgame, e.g. the Soulforged Ring tier
  // chain at L30/33/36/39/42) skip the late-game taper so each tier upgrade
  // actually grants more stat budget. Per-stat caps still apply.
  const taper = rarity === 'soulforged' ? 1.0 : getItemLevelTaper(level);
  // Slope 0.24 (squish v2, 2026-05): −20% per-level growth vs the original 0.3
  // to fight gear overshadowing base stats. Stacks multiplicatively with the
  // existing late-game taper.
  const raw = 2 + (level - 1) * 0.24 * mult * handsMult;
  // Hybrid efficiency: uncommons get +1 budget point at L30+ so they stay
  // attractive vs pure-primary commons after the taper kicks in.
  const hybridBonus = rarity === 'uncommon' && level >= 30 ? 1 : 0;
  // Floor of 2 even at L1 so every item has primary + minor stat.
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
  // Primary attribute cap. Linear until L28, then +1 every 6 levels, ceilings at 13.
  if (level <= 28) return 4 + Math.floor(level / 4);
  if (level <= 40) return 11 + Math.floor((level - 28) / 6);
  return 13;
}

/**
 * Max points of a single primary attribute on this item.
 * Anti-stacking rule: no more than 60% of the item's budget can go into one
 * primary stat (str/dex/con/int/wis/cha). Defensive stats (ac/hp/hp_regen)
 * keep their original level-based cap.
 */
export const SINGLE_STAT_BUDGET_RATIO = 0.6;
export function getEffectiveStatCap(
  statKey: string, level: number, budget: number, itemType: string = 'equipment',
): number {
  const baseCap = getItemStatCap(statKey, level, itemType);
  if (itemType === 'consumable') return baseCap;
  const isPrimary = ['str','dex','con','int','wis','cha'].includes(statKey);
  if (!isPrimary) return baseCap;
  // Floor of 1 so even a tiny 2-pt item still allows at least 1 primary point.
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
  if (mult === 0) return 0; // unique = unrepairable
  // All items have a fixed max durability of 100
  return Math.max(1, Math.ceil((100 - currentDurability) * value * mult / 100));
}

// ───────────────────────────────────────────────────────────────────────
// effectiveItemStats — per-instance stat resolution for the gem-upgrade
// system. Combines:
//   1. base stats          (stat_override if present, else items.stats)
//   2. applied_gems        (each gem → +N to its single attribute)
// All read paths (UI tooltips, inventory bonuses, combat-tick equipment
// aggregation) should use this so player-applied gems are counted exactly
// once, regardless of whether the underlying item template was migrated.
// ───────────────────────────────────────────────────────────────────────

/** Attribute granted by each primary gem key. */
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

/** Use the per-instance crafted_level if present, else the template level. */
export function effectiveItemLevel(itemLevel: number | null | undefined, craftedLevel?: number | null): number {
  return (craftedLevel ?? itemLevel ?? 1);
}

// ───────────────────────────────────────────────────────────────────────
// Tier helpers (Plain-Base catalog, 2026-07 overhaul).
//
// 5 tiers, each with its own crafted item level so weapon-die progression
// (10/20/30 thresholds in formulas/weapons.ts) lines up cleanly:
//
//   Tier 1 "Worn"      → player unlock 1   →  item level 1
//   Tier 2 "Sturdy"    → player unlock 10  →  item level 11  (+1 die)
//   Tier 3 "Engraved"  → player unlock 20  →  item level 21  (+2 die)
//   Tier 4 "Runed"     → player unlock 30  →  item level 31  (+3 die)
//   Tier 5 "Ancient"   → player unlock 40  →  item level 41  (+3 die*)
//   (*die cap is +3 in DEFAULT_WEAPON_PROGRESSION; T5 still gains stat
//    budget via its higher item level.)
// ───────────────────────────────────────────────────────────────────────

export const GEAR_TIERS = [
  { tier: 1, prefix: 'Worn',     unlockLevel: 1,  itemLevel: 1 },
  { tier: 2, prefix: 'Sturdy',   unlockLevel: 10, itemLevel: 11 },
  { tier: 3, prefix: 'Engraved', unlockLevel: 20, itemLevel: 21 },
  { tier: 4, prefix: 'Runed',    unlockLevel: 30, itemLevel: 31 },
  { tier: 5, prefix: 'Ancient',  unlockLevel: 40, itemLevel: 41 },
] as const;

/** Highest gear tier a character of the given player level can craft. */
export function getCraftableTierForLevel(playerLevel: number): number {
  let t = 1;
  for (const row of GEAR_TIERS) if (playerLevel >= row.unlockLevel) t = row.tier;
  return t;
}

/** The crafted_level snapshot we should stamp onto a freshly crafted base. */
export function getCraftedLevelForTier(tier: number): number {
  return GEAR_TIERS.find(r => r.tier === tier)?.itemLevel ?? 1;
}

