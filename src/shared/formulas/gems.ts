/**
 * gems.ts — Gem catalog & helpers.
 *
 * 6 primary gems (one per attribute) gate common forging.
 * 8 hybrid gems (one per archetype pair) gate uncommon forging.
 * Hybrids never drop — they're crafted by combining 2 matching primaries.
 *
 * The 8 hybrid pairs match the uncommon archetype catalog exactly. Each pair
 * has TWO directional archetype variants in the item catalog (e.g. INT+WIS gem
 * unlocks both "Mystic" INT-heavy and "Oracle" WIS-heavy items); the player
 * picks the variant they want from the forge browse list.
 *
 * CANONICAL OWNER for: GEM_CATALOG, PRIMARY_GEM_KEYS, HYBRID_GEM_KEYS,
 * gemForItem, hybridRecipe.
 */

export type GemKey =
  | 'garnet' | 'topaz' | 'emerald' | 'sapphire' | 'pearl' | 'amethyst'
  | 'citrine' | 'bloodstone' | 'sunstone' | 'jade' | 'heliodor'
  | 'aquamarine' | 'opal' | 'moonstone';

export type AttrKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface GemDef {
  key: GemKey;
  name: string;
  /** Display tint as HSL color string. */
  color: string;
  /** Single attribute (primary) or attribute pair (hybrid). */
  stats: AttrKey[];
  isHybrid: boolean;
}

export const GEM_CATALOG: Record<GemKey, GemDef> = {
  // Primary gems — one per attribute. Drop randomly from kills.
  garnet:    { key: 'garnet',    name: 'Garnet',    color: 'hsl(0, 70%, 50%)',    stats: ['str'],         isHybrid: false },
  topaz:     { key: 'topaz',     name: 'Topaz',     color: 'hsl(50, 90%, 55%)',   stats: ['dex'],         isHybrid: false },
  emerald:   { key: 'emerald',   name: 'Emerald',   color: 'hsl(140, 60%, 40%)',  stats: ['con'],         isHybrid: false },
  sapphire:  { key: 'sapphire',  name: 'Sapphire',  color: 'hsl(220, 70%, 50%)',  stats: ['int'],         isHybrid: false },
  pearl:     { key: 'pearl',     name: 'Pearl',     color: 'hsl(40, 30%, 90%)',   stats: ['wis'],         isHybrid: false },
  amethyst:  { key: 'amethyst',  name: 'Amethyst',  color: 'hsl(280, 60%, 55%)',  stats: ['cha'],         isHybrid: false },
  // Hybrid gems — one per archetype pair (8 total). Crafted by fusing 2 primaries.
  citrine:    { key: 'citrine',    name: 'Citrine',    color: 'hsl(30, 90%, 55%)',  stats: ['str', 'dex'], isHybrid: true },
  bloodstone: { key: 'bloodstone', name: 'Bloodstone', color: 'hsl(355, 55%, 38%)', stats: ['str', 'con'], isHybrid: true },
  sunstone:   { key: 'sunstone',   name: 'Sunstone',   color: 'hsl(20, 85%, 60%)',  stats: ['cha', 'str'], isHybrid: true },
  jade:       { key: 'jade',       name: 'Jade',       color: 'hsl(150, 35%, 45%)', stats: ['dex', 'wis'], isHybrid: true },
  heliodor:   { key: 'heliodor',   name: 'Heliodor',   color: 'hsl(48, 90%, 60%)',  stats: ['cha', 'dex'], isHybrid: true },
  aquamarine: { key: 'aquamarine', name: 'Aquamarine', color: 'hsl(190, 70%, 55%)', stats: ['wis', 'con'], isHybrid: true },
  opal:       { key: 'opal',       name: 'Opal',       color: 'hsl(250, 40%, 70%)', stats: ['int', 'wis'], isHybrid: true },
  moonstone:  { key: 'moonstone',  name: 'Moonstone',  color: 'hsl(210, 20%, 80%)', stats: ['cha', 'wis'], isHybrid: true },
};

export const PRIMARY_GEM_KEYS: GemKey[] =
  ['garnet', 'topaz', 'emerald', 'sapphire', 'pearl', 'amethyst'];

export const HYBRID_GEM_KEYS: GemKey[] =
  ['citrine', 'bloodstone', 'sunstone', 'jade', 'heliodor', 'aquamarine', 'opal', 'moonstone'];

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

/** Find the hybrid gem matching a stat pair (order-insensitive). Returns null if no match. */
export function hybridForPair(a: AttrKey, b: AttrKey): GemKey | null {
  for (const key of HYBRID_GEM_KEYS) {
    const def = GEM_CATALOG[key];
    const set = new Set(def.stats);
    if (set.has(a) && set.has(b)) return key;
  }
  return null;
}

/** Recipe for a hybrid gem: the two primary gems that fuse into it. */
export function hybridRecipe(hybridKey: GemKey): [GemKey, GemKey] | null {
  const def = GEM_CATALOG[hybridKey];
  if (!def?.isHybrid || def.stats.length !== 2) return null;
  return [gemForAttr(def.stats[0]), gemForAttr(def.stats[1])];
}

const ATTR_KEYS: AttrKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Pick the dominant attribute(s) from an item's stats. Returns top-N sorted by value. */
function topAttrs(stats: Record<string, number> | null | undefined, count: number): AttrKey[] {
  if (!stats) return [];
  const entries = ATTR_KEYS
    .map(k => [k, stats[k] || 0] as [AttrKey, number])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries.slice(0, count).map(([k]) => k);
}

/**
 * The gem required to forge a given item.
 * - common: primary gem matching the dominant attribute
 * - uncommon: hybrid gem matching the top-2 attribute pair. Returns null if the
 *   item's pair isn't in the catalog (corrupt/legacy data) or has <2 attrs.
 * - other rarities (rare/unique/soulforged) are not forgeable here → null
 */
export function gemForItem(stats: Record<string, number> | null | undefined, rarity: string): GemKey | null {
  if (rarity === 'common') {
    const top = topAttrs(stats, 1);
    if (!top.length) return null;
    return gemForAttr(top[0]);
  }
  if (rarity === 'uncommon') {
    const top = topAttrs(stats, 2);
    if (top.length < 2) return null;
    return hybridForPair(top[0], top[1]);
  }
  return null;
}

/** Default tunables — drop chance per kill and salvage cost per primary gem. */
export const GEM_DROP_CHANCE = 0.10;
export const GEM_SALVAGE_COST_PRIMARY = 25;
