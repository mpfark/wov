

# Add Potion Slots to Soulforge Belt

## What
When a player forges a belt via the Soulwright, they should be able to allocate `potion_slots` as a stat — determining how many potions can be belted for combat use.

## Current State
- `potion_slots` is a belt-only stat managed in admin ItemManager but not exposed in the Soulforge dialog
- The Soulforge STAT_KEYS list (`str, dex, con, int, wis, cha, ac, hp, hp_regen`) doesn't include `potion_slots`
- The edge function's STAT_KEYS validation also excludes it
- Belt capacity reads from `item.stats.potion_slots` (currently falls back to 3, pending the `?? 0` fix)

## Changes

### 1. `src/components/game/SoulforgeDialog.tsx`
- Add `potion_slots` to `STAT_KEYS` and `STAT_LABELS` (label: "Potion Slots")
- Conditionally show `potion_slots` only when `slot === 'belt'` — filter STAT_KEYS in the render loop
- No cap/cost changes needed on client since it defers to `getItemStatCap` and `ITEM_STAT_COSTS`

### 2. `src/lib/game-data.ts`
- Add `potion_slots` to `ITEM_STAT_COSTS` with a cost of **3** per slot (same weight as AC — powerful belt-only stat)
- Add `potion_slots` cap logic in `getItemStatCap`: cap at **4** (reasonable max potion slots for a soulforged belt)

### 3. `supabase/functions/soulforge-item/index.ts`
- Add `"potion_slots"` to the `STAT_KEYS` array
- Add `potion_slots: 3` to `STAT_COSTS` (matching client)
- Add `potion_slots` handling in `getStatCap`: return 4

### Summary
Three files, small additions to each — exposes an existing stat to the Soulforge UI when the belt slot is selected, with server-side validation to match.

