/**
 * economy.ts — Vendor / gold / encumbrance / teleport-cost formulas.
 *
 * CANONICAL OWNER for: CHA price multipliers, CHA gold multiplier,
 * carry capacity / bag weight / move cost, teleport CP cost.
 */

import { getStatModifier, diminishingFloat } from './stats';

// ── CHA → vendor & gold ─────────────────────────────────────────

export function getChaSellMultiplier(cha: number): number {
  const mod = Math.max(0, getStatModifier(cha));
  return Math.min(0.8, 0.5 + Math.sqrt(mod) * 0.03);
}

export function getChaBuyDiscount(cha: number): number {
  return diminishingFloat(getStatModifier(cha), 0.02, 0.10);
}

/** CHA → Bonus gold from humanoid kills: sqrt curve, capped at +25% */
export function getChaGoldMultiplier(cha: number): number {
  return 1 + diminishingFloat(getStatModifier(cha), 0.05, 0.25);
}

// ── Encumbrance ──────────────────────────────────────────────────

export function getCarryCapacity(str: number): number {
  const strMod = getStatModifier(str);
  return Math.max(12 + strMod, 10);
}

/** Calculate weighted bag size: equipment = 1 slot, consumables = 1/3 slot */
export function getBagWeight(bagItems: { item: { item_type: string } }[]): number {
  let weight = 0;
  for (const i of bagItems) {
    weight += i.item.item_type === 'consumable' ? 1 / 3 : 1;
  }
  return Math.ceil(weight);
}

export function getMoveCost(bagWeight: number, str: number): number {
  const capacity = getCarryCapacity(str);
  const itemsOver = Math.max(0, bagWeight - capacity);
  return 10 + itemsOver * 5;
}

// ── Teleport CP cost (shared between teleport & summon) ─────────

export function calculateTeleportCpCost(
  fromRegionMinLevel: number | undefined,
  toRegionMinLevel: number,
  sameRegion: boolean,
): number {
  if (fromRegionMinLevel === undefined) return 15;
  if (sameRegion) return 10;
  const levelDiff = Math.abs(toRegionMinLevel - fromRegionMinLevel);
  return Math.min(10 + levelDiff * 2, 30);
}
