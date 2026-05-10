
# Gem-Gated Forging

Add **gems** as a second forging material alongside salvage. Gems are color-coded to attribute stats and filter the forge pool so the player can only forge items whose primary stat matches a gem they own. Forces more deliberate farming for stat-aligned gear instead of cycling pure salvage.

Also reopens **uncommon (hybrid)** forging at Blacksmith and Jewelcrafter, which an earlier iteration restricted to commons only — uncommons now require a hybrid gem, which is the new gating mechanic.

## Gem catalog (12 gems, 6 primary + 6 hybrid)

| Gem | Color | Stat |
|---|---|---|
| Garnet | Red | STR |
| Topaz | Yellow | DEX |
| Emerald | Green | CON |
| Sapphire | Blue | INT |
| Pearl | White | WIS |
| Amethyst | Purple | CHA |
| Citrine | Orange | STR + DEX |
| Jade | Teal | DEX + CON |
| Aquamarine | Cyan | CON + INT |
| Opal | Pale violet | INT + WIS |
| Moonstone | Silver | WIS + CHA |
| Sunstone | Gold-pink | CHA + STR |

The 6 hybrids cover the same stat pairs already used by the uncommon hybrid archetypes (see `mem://game/item-archetypes`). For uncommon items the gem must match the **dominant stat pair**, derived from the item's top-2 stats.

## Source: random drops + crafted hybrids

- **Creature drops:** since all creatures share the same scaled stat profile, gem drops are **random** for now. On any creature kill (humanoid or non-humanoid), roll a small chance (e.g. 8–12%) for a gem drop. If the roll succeeds, pick one gem uniformly from the 6 primary gems. Hybrids never drop directly. Tunable via a small config row.
- **Salvage trade for primary gems:** at the Jewelcrafter, trade salvage for any chosen primary gem (~25 salvage each, tunable). Acts as bad-luck protection on top of drops.
- **Combine for hybrid gems:** at the Jewelcrafter, fuse **1 of each matching primary gem** into 1 hybrid gem (e.g. 1 Garnet + 1 Topaz → 1 Citrine). No salvage cost on top, the cost is the two primaries themselves. This makes uncommons meaningfully harder to forge: you need both primary gems for that stat pair before you can roll an uncommon item.

This keeps the economy simple — only primary gems enter the world; hybrids are crafted by the player.

## Forge flow change

### Reopen uncommons
- Both `blacksmith-forge` and `jewelcrafter-forge` currently hardcode `.eq("rarity", "common")`. Remove that and include `common` and `uncommon` in the pool. Repair/sell flows untouched.

### Filter the pool by owned gems
1. Player picks a slot.
2. The forge pool query returns items whose required gem (derived from primary stat for commons, or top-2 stat pair for uncommons) is present in the player's gem pouch with count > 0.
3. Selecting an item shows the gem cost (1 matching gem) inline with salvage + gold.
4. Forging deducts 1 gem in addition to existing salvage + gold.

If the player owns no matching gems, the forge UI shows an empty pool with a hint pointing at the new "Trade Salvage / Combine Gems" panel.

## UI

- Add a **Gem Pouch** strip at the top of both forge tabs: 12 small icons with counts (greyed at 0). Tooltip shows gem name + stat.
- Add a **"Gemcutting"** sub-panel inside Jewelcrafter with two actions:
  - *Trade Salvage* — pick a primary gem, pay salvage.
  - *Combine* — pick a hybrid; shows the two required primaries with current counts and a one-click fuse button (disabled if either primary count is 0).
- Each forge pool entry gets a small gem icon next to its name showing what it requires.
- Inventory/Character panel: no changes — gems live in a dedicated `character_gems` count table, not as inventory items.

## Out of scope
- Crown / Soulforge unchanged (endgame already stat-flexible).
- Repair, vendor, marketplace unchanged.
- No socketing / re-enchanting existing items in this pass.
- No per-creature gem tuning yet (revisit if/when creatures get stat-profile differentiation).

---

## Technical sketch

**Schema (migration)**
- `character_gems(character_id uuid, gem_key text, count int, primary key (character_id, gem_key))` with RLS: owner can SELECT, service role full access.
- Shared TS module `shared/formulas/gems.ts` (+ mirror in `supabase/functions/_shared/formulas/gems.ts`) with the 12 gem keys, colors, stat mapping, helpers `gemForItem(stats, rarity)` and `hybridRecipe(hybridKey)` returning the two primary keys, and the random-drop pool (the 6 primaries).

**Edge function changes**
- `blacksmith-forge` and `jewelcrafter-forge`:
  - Remove the `.eq("rarity", "common")` restriction; allow `common` + `uncommon`.
  - Browse: after fetching pool by slot/level, filter to entries where `gemForItem(item.stats, item.rarity)` exists in the caller's `character_gems` with count > 0.
  - Forge: validate matching gem still owned, decrement gem count atomically with salvage/gold deduction.
- `kill-resolver` (`supabase/functions/_shared/kill-resolver.ts`): in the loot resolution step, run a single gem-drop roll using the configured chance. On success, upsert `character_gems` count for a uniformly-random primary gem. Log it like other drops.
- New edge function `jewelcrafter-gemcutter` (or new `mode` branches on `jewelcrafter-forge`):
  - `trade_gem` — salvage → chosen primary gem.
  - `combine_gem` — 2 specific primaries → 1 chosen hybrid (validates the recipe, decrements both primaries, increments the hybrid).

**Frontend**
- New hook `useCharacterGems(characterId)` with realtime subscription on `character_gems`.
- `BlacksmithPanel` + `JewelcrafterPanel`: add Gem Pouch strip, gem-required badge per pool item, gem cost in footer line. Pass `gems` map down.
- New `GemPouch.tsx` shared component.
- New `GemcuttingPanel.tsx` sub-panel for Jewelcrafter (trade + combine).
- Tooltip card: optionally show "Requires: [gem icon] Garnet" when browsing.

**Memory**
- Add `mem://game/gem-system` describing catalog, mapping, drop sources (random primary on kill, salvage trade for primaries, combine 2 primaries into 1 hybrid), and forge gating.
