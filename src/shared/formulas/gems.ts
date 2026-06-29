/**
 * gems.ts — Gem catalog & helpers.
 *
 * 6 PRIMARY gems (one per attribute) are the only gems in the game.
 * Each primary gem applied at the forge adds +1 to its attribute on an item
 * (subject to per-stat caps and the item's stat budget).
 *
 * Hybrid gems have been retired. Historic catalog stubs and helpers remain
 * exported only so older imports do not crash during the transition; the
 * stubs return empty/null. Any caller still using them should migrate to
 * the primary-only flow.
 *
 * CANONICAL OWNER for: GEM_CATALOG, PRIMARY_GEM_KEYS, gemForAttr,
 * attrForGem, GEM_DROP_CHANCE, GEM_SALVAGE_COST_PRIMARY.
 *
 * Mirror: `supabase/functions/_shared/formulas/gems.ts`. Keep in sync.
 */

export type GemKey =
  | 'garnet' | 'topaz' | 'emerald' | 'sapphire' | 'pearl' | 'amethyst';

export type AttrKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface GemDef {
  key: GemKey;
  name: string;
  color: string;
  stats: AttrKey[];
  /** Retained for API compatibility; always false in the primary-only system. */
  isHybrid: boolean;
}

export const GEM_CATALOG: Record<GemKey, GemDef> = {
  garnet:   { key: 'garnet',   name: 'Garnet',   color: 'hsl(0, 70%, 50%)',   stats: ['str'], isHybrid: false },
  topaz:    { key: 'topaz',    name: 'Topaz',    color: 'hsl(50, 90%, 55%)',  stats: ['dex'], isHybrid: false },
  emerald:  { key: 'emerald',  name: 'Emerald',  color: 'hsl(140, 60%, 40%)', stats: ['con'], isHybrid: false },
  sapphire: { key: 'sapphire', name: 'Sapphire', color: 'hsl(220, 70%, 50%)', stats: ['int'], isHybrid: false },
  pearl:    { key: 'pearl',    name: 'Pearl',    color: 'hsl(40, 30%, 90%)',  stats: ['wis'], isHybrid: false },
  amethyst: { key: 'amethyst', name: 'Amethyst', color: 'hsl(280, 60%, 55%)', stats: ['cha'], isHybrid: false },
};

export const PRIMARY_GEM_KEYS: GemKey[] =
  ['garnet', 'topaz', 'emerald', 'sapphire', 'pearl', 'amethyst'];

/** Hybrid system retired; empty list kept for backward compatibility. */
export const HYBRID_GEM_KEYS: GemKey[] = [];

/** Map a single attribute to its primary gem. */
export function gemForAttr(attr: AttrKey): GemKey {
  switch (attr) {
    case 'str': return 'garnet';
    case 'dex': return 'topaz';
    case 'con': return 'emerald';
    case 'int': return 'sapphire';
    case 'wis': return 'pearl';
    case 'cha': return 'amethyst';
  }
}

/** Reverse map: gem → the single attribute it grants. */
export function attrForGem(gem: GemKey): AttrKey {
  return GEM_CATALOG[gem].stats[0];
}

/** @deprecated Hybrid gems retired. Always returns null. */
export function hybridForPair(_a: AttrKey, _b: AttrKey): GemKey | null {
  return null;
}

/** @deprecated Hybrid gems retired. Always returns null. */
export function hybridRecipe(_hybridKey: GemKey): [GemKey, GemKey] | null {
  return null;
}

/**
 * @deprecated Items are no longer gated by a single "required gem". Players
 * pick gems at upgrade time. Stub returns null so legacy code paths fall back
 * to a safe "no requirement" branch.
 */
export function gemForItem(_stats: Record<string, number> | null | undefined, _rarity: string): GemKey | null {
  return null;
}

/** Default tunables — drop chance per kill and salvage cost per primary gem. */
export const GEM_DROP_CHANCE = 0.10;
export const GEM_SALVAGE_COST_PRIMARY = 25;
