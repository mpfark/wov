/**
 * Appearance resolver — single path for all items (shared pool entries AND unique entries).
 *
 * Resolution rules (same for every item):
 *   1. If item.appearance_key is set → look up that entry directly.
 *   2. Else → infer a default entry from (slot, weapon_tag/material hint, rarity tier)
 *      so legacy items with no key still render something sensible.
 */

import { ITEM_SLOT_TO_DOLL_SLOT, type DollSlot } from './doll-contract';

export interface AppearanceEntry {
  id: string;
  slot: string;
  material: string;
  tier: string;
  asset_url: string;
  layer_order: number | null;
  occludes: string[];
  is_shared: boolean;
  display_name: string;
}

export interface ResolvableItem {
  slot: string | null;
  rarity: string;
  weapon_tag?: string | null;
  appearance_key?: string | null;
}

/**
 * Material inference from weapon tag / item type.
 * Kept simple — admins can override by setting an explicit appearance_key.
 */
function inferMaterial(item: ResolvableItem): string {
  const tag = item.weapon_tag?.toLowerCase() ?? '';
  if (item.slot === 'main_hand' || item.slot === 'off_hand') {
    if (tag.includes('bow') || tag.includes('staff') || tag.includes('wand')) return 'wood';
    if (tag.includes('shield')) return 'metal';
    return 'metal';
  }
  // Armor inference: defaults to leather; common tier = cloth/leather, uncommon+ = metal
  if (item.rarity === 'uncommon') return 'leather';
  if (item.rarity === 'unique') return 'unique';
  return 'cloth';
}

/**
 * Resolve an item to an appearance entry from the library.
 * Returns null if no doll-renderable slot mapping exists.
 */
export function resolveAppearance(
  item: ResolvableItem,
  entries: AppearanceEntry[],
): AppearanceEntry | null {
  if (!item.slot) return null;
  const dollSlot = ITEM_SLOT_TO_DOLL_SLOT[item.slot];
  if (!dollSlot) return null;

  // Path 1: explicit key
  if (item.appearance_key) {
    const direct = entries.find((e) => e.id === item.appearance_key);
    if (direct) return direct;
  }

  // Path 2: infer (slot, material, tier)
  const material = inferMaterial(item);
  const tier = item.rarity === 'unique' ? 'unique' : item.rarity === 'uncommon' ? 'uncommon' : 'common';

  // Best match: same slot + material + tier, prefer is_shared
  const exact = entries.find(
    (e) => e.slot === dollSlot && e.material === material && e.tier === tier && e.is_shared,
  );
  if (exact) return exact;

  // Fallback: same slot + tier
  const tierMatch = entries.find((e) => e.slot === dollSlot && e.tier === tier && e.is_shared);
  if (tierMatch) return tierMatch;

  // Fallback: same slot, any
  const slotMatch = entries.find((e) => e.slot === dollSlot && e.is_shared);
  return slotMatch ?? null;
}

/**
 * Resolve the base body entry for a character based on gender.
 * Materials are 'male' / 'female' on slot='base_body'.
 */
export function resolveBaseBody(
  gender: 'male' | 'female',
  entries: AppearanceEntry[],
): AppearanceEntry | null {
  return entries.find((e) => e.slot === 'base_body' && e.material === gender) ?? null;
}

export function getDollSlotForItemSlot(itemSlot: string | null): DollSlot | null {
  if (!itemSlot) return null;
  return ITEM_SLOT_TO_DOLL_SLOT[itemSlot] ?? null;
}
