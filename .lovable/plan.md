

# Update Item Forge: Batch + Single Mode, Deduplicate Names

## Summary

Replace the "Loot Table" forge mode with a "Batch" mode that saves items directly to the `items` table (no loot table creation). Keep single mode. Add server-side duplicate name rejection and show weapon tags in the preview cards.

## Changes

### 1. Update `src/components/admin/ItemForgePanel.tsx`

**Replace forge modes**: Change `'loot_table' | 'single'` to `'batch' | 'single'`. Remove all loot table creation logic (table name input, `savedTableId`, creature assignment UI).

**Batch mode apply**: Insert all generated items directly into `items` table with `world_drop: true`. No loot table or loot_table_entries created.

**Include `weapon_tag`** in the `ForgedItem` interface and pass it through on insert. Show weapon tag in each item's preview card meta row (e.g. `⚔ sword`).

**Duplicate name check on save**: Before inserting, query `items` table for any matching names. Filter out items whose names already exist, toast a warning for skipped duplicates, and only insert the unique ones.

**Remove loot table UI**: Remove table name input, creature picker assignment section, `savedTableId` state, `assignToCreature` function, and related loot table imports.

### 2. Update `supabase/functions/ai-item-forge/index.ts`

**Increase existing name fetch limit**: Change `.limit(500)` to `.limit(5000)` (or remove limit) to ensure the AI prompt has visibility into all existing item names for deduplication during generation.

### 3. Deploy edge function

Deploy updated `ai-item-forge`.

## Files Modified

| File | Change |
|------|--------|
| `src/components/admin/ItemForgePanel.tsx` | Replace loot_table mode with batch, add weapon_tag display, add duplicate name filtering on save |
| `supabase/functions/ai-item-forge/index.ts` | Increase existing item name query limit |

