

# Vendor & Blacksmith Panel Redesign

## Summary

Redesign both panels to use a fixed-height, two-column layout inside the existing ScrollPanel aesthetic, and replace the random blacksmith forge with a deterministic item-browsing system.

## Layout Changes (Both Panels)

**ScrollPanel** gets a new `wide` prop that sets `max-w-2xl` and a fixed `min-h-[60vh]` so the container stays stable regardless of content length. Each column scrolls independently via `overflow-y-auto`.

### Vendor Panel — Two Columns

| Left Column: "For Sale" | Right Column: "Your Inventory" |
|---|---|
| Vendor stock list with Buy buttons | Sellable items with Sell buttons |

Gold bar + CHA info stays in the header above both columns. No tabs — everything visible at once.

### Blacksmith Panel — Two Columns, No Tabs

| Left Column: "Services" | Right Column: "Repair" |
|---|---|
| **Forge**: Slot selector → shows available items for that slot (queried from `items` table, filtered by level ±2/±5). Player picks the exact item they want, then clicks Forge. | Damaged items list with Repair / Repair All buttons |
| **Sell Salvage**: Slider + sell button (compact, below forge) | |

This removes the 3-tab system entirely — everything is visible in two columns.

## Forge Redesign: Deterministic Item Selection

### Client-side changes (`BlacksmithPanel.tsx`)

When the player selects a slot, fetch available forgeable items from the edge function (new endpoint or modified existing one):

1. Player picks a slot → client calls a new `blacksmith-browse` edge function (or the existing `blacksmith-forge` with a `mode: "browse"` flag)
2. Returns the pool of items available for that slot at the character's level (same filtering logic as current forge: ±2 then ±5, non-soulbound, non-unique)
3. Items are displayed in a scrollable list grouped by rarity, showing name, stats, rarity color
4. Player clicks an item → clicks "Forge" → edge function receives `item_id` instead of random selection

### Edge function changes (`blacksmith-forge/index.ts`)

Add two modes:

**Browse mode** (`mode: "browse"`): Returns the filtered item pool for a given slot without deducting resources. New request body: `{ character_id, slot, mode: "browse" }`.

**Forge mode** (`mode: "forge"` or default): Accepts `{ character_id, slot, item_id }`. Validates the requested `item_id` exists in the valid pool (same filters), then deducts resources and grants the item. No more random selection.

This keeps server authority — the server validates the chosen item is in the allowed pool.

## Files Modified

| File | Change |
|---|---|
| `src/features/inventory/components/ScrollPanel.tsx` | Add optional `wide` prop for two-column panels with fixed min-height |
| `src/features/inventory/components/VendorPanel.tsx` | Two-column layout, remove stacked sections |
| `src/features/inventory/components/BlacksmithPanel.tsx` | Two-column layout, remove tabs, add item browser for forge |
| `supabase/functions/blacksmith-forge/index.ts` | Add browse mode, accept specific `item_id` in forge mode |

## What Does NOT Change

- Economy formulas, costs, rarity distribution of available items
- Server authority for purchases/forging
- Vendor RPC functions (`buy_vendor_item`, `sell_item`)
- The ornate parchment/wax-seal aesthetic of ScrollPanel
- Item stat budgets or forge pool content

