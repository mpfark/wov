

# Replace `forge_pool` with `items` table for blacksmith forging

## Summary

Change the `blacksmith-forge` edge function to query the `items` table directly instead of the `forge_pool` table. This eliminates the need to maintain a separate pool. The admin `ItemForgePanel` forge_pool mode becomes unnecessary.

## Changes

### 1. `supabase/functions/blacksmith-forge/index.ts`

Replace all `forge_pool` queries with `items` table queries using the same tiered fallback logic:

- Query `items` where `item_type = 'equipment'`, `slot = <slot>`, `rarity = <rolled rarity>`, `level` within ±2, `is_soulbound = false`, `rarity != 'unique'`
- Fallback: widen to ±5, same filters
- Fallback: any rarity (still excluding unique/soulbound) within ±5

Instead of cloning (inserting a new item row), the forge will pick an existing item ID and add it directly to `character_inventory`. This matches how loot drops and vendor purchases already work — items are shared templates, not per-instance copies.

Wait — actually the current system clones a template into a *new* item row each time. This is intentional because items can have per-instance durability tracked in `character_inventory`. Looking at the schema, `character_inventory` has `current_durability` per row, and items are reused by ID elsewhere (vendors, loot). So reusing existing item IDs is fine — no need to clone. The forge should just pick a random matching item and insert a `character_inventory` row pointing to it.

### 2. `src/components/admin/ItemForgePanel.tsx`

Remove the `forge_pool` mode option from the admin panel since it's no longer needed. Remove:
- The `forge_pool` option from the `forgeMode` select
- The `loadPoolStock` function and `poolStock` state
- The forge pool stock display section
- The forge_pool branch in `applyAll`

Default `forgeMode` stays as `'loot_table'`.

### 3. No database migration needed

The `forge_pool` table can remain for now (no breaking change). It simply won't be queried anymore. It can be dropped in a future cleanup.

## Technical Details

**Edge function query change** (pseudocode):
```typescript
// Instead of: db.from("forge_pool")
// Now:
let { data: pool } = await db
  .from("items")
  .select("*")
  .eq("item_type", "equipment")
  .eq("slot", slot)
  .eq("rarity", rarity)
  .eq("is_soulbound", false)
  .neq("rarity", "unique")
  .gte("level", char.level - 2)
  .lte("level", char.level + 2);
```

**Inventory insert change**: Instead of creating a new item row, just reference the existing item:
```typescript
// Remove the items.insert() call
// Just add to inventory directly:
await db.from("character_inventory").insert({
  character_id,
  item_id: template.id,  // existing item ID
  current_durability: 100,
});
```

**Exclusion filters**: `is_soulbound = false` and `rarity != 'unique'` ensure soulforged and unique items are never forged.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/blacksmith-forge/index.ts` | Query `items` table instead of `forge_pool`; skip item cloning |
| `src/components/admin/ItemForgePanel.tsx` | Remove forge_pool mode and stock display |

## Constraints

- Zero gameplay formula changes (same costs, same rarity odds)
- Soulbound and unique items excluded
- No database migration needed

