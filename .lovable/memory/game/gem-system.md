---
name: gem-system
description: Gem catalog, drop rules, and forging recipes that gate Blacksmith/Jewelcrafter forging by stat-aligned gems.
type: feature
---
Gems are a second forging material alongside salvage + gold. They gate which item shows up in the Blacksmith/Jewelcrafter forge pool by matching the item's dominant attribute(s).

## Catalog (12 gems)
Canonical owner: `src/shared/formulas/gems.ts` (mirrored to `supabase/functions/_shared/formulas/gems.ts`).

Primary (6, one per attribute):
- Garnet (red) → STR
- Topaz (yellow) → DEX
- Emerald (green) → CON
- Sapphire (blue) → INT
- Pearl (white) → WIS
- Amethyst (purple) → CHA

Hybrid (6, one per attribute pair):
- Citrine (orange) → STR+DEX
- Jade (teal) → DEX+CON
- Aquamarine (cyan) → CON+INT
- Opal (pale violet) → INT+WIS
- Moonstone (silver) → WIS+CHA
- Sunstone (gold-pink) → CHA+STR

## Drops
- Per-kill roll on every recipient in `_shared/kill-resolver.ts`. Chance = `GEM_DROP_CHANCE` (default 0.10).
- On success, drop is uniformly random from the 6 **primary** gems. Hybrids never drop.
- All creatures use the same pool — creature stat profile does not influence the gem (creatures are uniformly stat-scaled today).
- Drops are aggregated in `combat-tick` / `combat-catchup` and upserted into `character_gems(character_id, gem_key, count)`.

## Crafting hybrids (Jewelcrafter)
- Combine 1 of each matching primary → 1 hybrid (e.g. Garnet + Topaz → Citrine). No salvage/gold cost on top.
- Salvage trade for primaries: ~25 salvage per primary gem (`GEM_SALVAGE_COST_PRIMARY`), bad-luck protection.

## Forge gating
- `blacksmith-forge` and `jewelcrafter-forge` allow `common` + `uncommon` (uncommons were reopened with the gem system).
- Pool is filtered to items where `gemForItem(stats, rarity)` is owned with count > 0:
  - common → primary gem of the dominant attribute
  - uncommon → hybrid gem matching the top-2 attribute pair
  - rare/unique/soulforged → not gated here (different flow)
- On forge: deduct 1 matching gem in addition to existing salvage + gold cost.

## Out of scope
No socketing or re-enchanting existing items. Crown/Soulforge unchanged. No per-creature gem tuning until creature stat profiles diverge.
