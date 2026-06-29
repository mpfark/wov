/**
 * gems.ts — Gem catalog & helpers (edge mirror of src/shared/formulas/gems.ts).
 *
 * Primary-only system: 6 gems, each grants +1 to one attribute when applied
 * at the forge. Hybrid gems retired; stubs kept for transitional compatibility.
 */

export type GemKey =
  | 'garnet' | 'topaz' | 'emerald' | 'sapphire' | 'pearl' | 'amethyst';

export type AttrKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface GemDef {
  key: GemKey;
  name: string;
  color: string;
  stats: AttrKey[];
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

export const HYBRID_GEM_KEYS: GemKey[] = [];

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

export function attrForGem(gem: GemKey): AttrKey {
  return GEM_CATALOG[gem].stats[0];
}

export function hybridForPair(_a: AttrKey, _b: AttrKey): GemKey | null { return null; }
export function hybridRecipe(_hybridKey: GemKey): [GemKey, GemKey] | null { return null; }
export function gemForItem(_s: Record<string, number> | null | undefined, _r: string): GemKey | null { return null; }

export const GEM_DROP_CHANCE = 0.10;
export const GEM_SALVAGE_COST_PRIMARY = 25;
