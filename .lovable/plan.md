## Goal

Stop generating hundreds of pre-statted item variants. World/forge drops become **plain bases** (slot, level, AC/HP only). Players choose stats by **socketing primary gems** at the forge. Hybrid gems are removed.

## Rules

- **Gems**: only the 6 primary gems (garnet/topaz/emerald/sapphire/pearl/amethyst). Each = +1 to its stat per application.
- **Upgrading**: applying a gem at the blacksmith (armor/weapons) or jewelcrafter (ring/trinket) consumes 1 gem + salvage + gold, and adds +1 to that stat on the item.
- **Caps per item**: same as today (`getItemStatCap` from `formulas/items.ts`) — so a single stat can be maxed out, but total points are bounded by the item's stat budget (`getItemStatBudget`).
- **Switching to a higher-level base = start over**: stats don't carry across bases. (Player crafts new base, re-applies gems.)
- **Re-customize**: a "Reforge / Strip" action removes all gems for a salvage+gold cost; refunds NO gems (matches your answer "costs salvage/gold").
- **Migration (existing inventory)**: strip stats off every owned item back to its base; refund the gem equivalent of the stripped stats into the player's gem pouch (1 stat point = 1 primary gem of that stat). Items keep their slot/level/AC/HP/durability.

## Data model

- Add columns to `character_inventory`:
  - `applied_gems jsonb` — `{ "garnet": 2, "topaz": 1, ... }` per-instance stat additions.
- Stats shown on an item instance = base item stats (AC/HP only on plain bases) + applied_gems mapped to stat points. UI and combat read effective stats through a single helper.
- `items` table: world drops + forge pool become "plain" bases. Mark with `item_type='equipment'` and empty stat block (or AC/HP only). Existing rich variants get retired from drop tables.
- Remove hybrid gems from `GEM_CATALOG`, `materials`, drop logic, and `gemForItem`. Convert any hybrid gems players own into 2 matching primaries.

## Forge UX

Blacksmith / Jewelcrafter panels get two tabs:
1. **Craft Base** — pick slot, pay salvage+gold, receive a plain base at your level.
2. **Upgrade** — pick an owned item, see current stats vs budget, click a gem to spend 1 gem + salvage + gold and add +1 to that stat. Disabled when stat cap or item budget is reached. "Strip" button clears all applied gems for a fixed cost.

## Cost model (initial tuning, adjustable)

- Craft base: same as today's forge cost (`salvage = 5 + level*2`, `gold = level*5`).
- Apply gem: 1 gem + `2 + level` salvage + `level*2` gold per +1.
- Strip: `level*10` gold + `level*3` salvage. Gems are destroyed.

## Code changes

- `src/shared/formulas/gems.ts` + `supabase/functions/_shared/formulas/gems.ts`: drop hybrid catalog, `hybridForPair`, `hybridRecipe`. `gemForItem` deleted (no longer used).
- `src/shared/formulas/items.ts` (+ mirror): keep budget/cap helpers. Add `effectiveItemStats(baseStats, appliedGems)` helper used by both client and edge functions.
- New edge functions:
  - `forge-craft-base` — replaces current browse/forge mode; spawns plain base into inventory.
  - `forge-apply-gem` — validates ownership, gem ownership, cap, budget; consumes resources; updates `applied_gems` atomically.
  - `forge-strip` — clears `applied_gems`, charges cost.
- Replace `blacksmith-forge` and `jewelcrafter-forge` with thin wrappers that route to the three new functions (or retire and update client to call the new ones directly).
- `BlacksmithPanel.tsx` and `JewelcrafterPanel.tsx`: rewritten for Craft / Upgrade tabs; use existing `notifyMaterialsChanged` + `useInventory` refresh.
- `ItemTooltipCard.tsx` / item display utils: show base stats + applied gem stats (e.g. `STR +2 (gem)`).
- `seed-archetype-items`, `ai-item-forge`, drop tables, `forge_pool`: stop generating stat-rich items for common/uncommon; produce plain bases instead. Keep unique/soulforged path untouched (those keep their hand-crafted stats).
- `useMaterials` already handles refresh signal — reuse.

## Migration SQL

1. `ALTER TABLE character_inventory ADD COLUMN applied_gems jsonb NOT NULL DEFAULT '{}'::jsonb`.
2. For each owned inventory row: refund each stat point on the item as 1 matching primary gem into `character_materials` (via existing `add_material`), then null/zero the item's stats on the **instance** (we'll keep `items.stats` intact for unique/soulforged; for common/uncommon, replace the item reference with a plain base of the same slot+level).
3. For each owned hybrid gem in `character_materials`: convert to its 2 primaries, then delete hybrid rows.
4. Retire hybrid material rows from `materials` table and drop hybrid entries from `forge_pool`.

## Out of scope (won't change this pass)

- Unique / Soulforged items keep their fixed stats and current crafting paths.
- Stonebinder, marketplace listings of existing items (will keep displaying baked stats until stripped).
- Combat math, ability scaling, stat caps formulas — unchanged.

## Risks

- Marketplace listings created with old pre-statted items remain valid; we'll let them expire naturally.
- `effectiveItemStats` must be the single source of truth — any place still reading raw `items.stats` for common/uncommon will under-report. Audit `useInventory`, `effective.ts`, `combat-tick`, `CharacterPanel`, tooltip code.
