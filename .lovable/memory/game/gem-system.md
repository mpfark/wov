---
name: gem-system
description: Gem catalog (6 primary + 8 hybrid), drop rules, and forging recipes. Hybrid gems map 1:1 to archetype pairs.
type: feature
---
Gems are a second forging material alongside salvage + gold. They gate which item shows up in the Blacksmith/Jewelcrafter forge pool by matching the item's dominant attribute(s).

## Catalog (14 gems)
Canonical owner: `src/shared/formulas/gems.ts` (mirrored to `supabase/functions/_shared/formulas/gems.ts`).

Primary (6, one per attribute):
- Garnet (red) → STR · Topaz (yellow) → DEX · Emerald (green) → CON
- Sapphire (blue) → INT · Pearl (white) → WIS · Amethyst (purple) → CHA

Hybrid (8, one per archetype pair):
- Citrine (orange) → STR+DEX
- Bloodstone (deep red) → STR+CON
- Sunstone (gold-pink) → CHA+STR
- Jade (mossy green) → DEX+WIS
- Heliodor (golden yellow) → CHA+DEX
- Aquamarine (cyan) → WIS+CON
- Opal (pale violet) → INT+WIS
- Moonstone (silver) → CHA+WIS

The 8 hybrid pairs match the uncommon archetype catalog 1:1; each hybrid gem unlocks both directional variants of its pair (e.g. Opal forges either Mystic INT-heavy or Oracle WIS-heavy — the player picks at browse time).

## Drops
- Per-kill roll on every recipient. Chance = `GEM_DROP_CHANCE` (default 0.10).
- On success, drop is uniformly random from the 6 **primary** gems. Hybrids never drop.

## Crafting hybrids (Jewelcrafter)
- Combine 1 of each matching primary → 1 hybrid (e.g. Garnet + Emerald → Bloodstone).
- Salvage trade for primaries: 25 salvage per primary gem.

## Forge gating
- `blacksmith-forge` and `jewelcrafter-forge` allow `common` + `uncommon`.
- Pool filtered to items where `gemForItem(stats, rarity)` is owned with count > 0.
- On forge: deduct 1 matching gem in addition to salvage + gold cost.

## Out of scope
No socketing or re-enchanting. Crown/Soulforge unchanged.
