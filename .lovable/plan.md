

# Rule-Based Loot Pool System

## Summary

Add an automatic, rule-based loot system alongside the existing manual loot tables. Normal humanoids will draw from the world-drop item pool by level and rarity. Creatures drop salvage only. Bosses and special enemies keep manual loot tables. A new admin UI replaces the current Loot Tables tab with a comprehensive loot management page.

## Current State

- 274 creatures: 183 non-humanoid without loot tables, 60 humanoid with manual loot tables, 8 bosses with inline loot
- 293 equipment items (163 common, 130 uncommon, 8 unique), 26 consumables
- Loot resolution happens in three places: `combat-tick`, `combat-catchup`, and client-side `useCombatActions.rollLoot`
- Items have no `world_drop` or `drop_weight` fields yet
- Creatures have no `loot_mode` field yet

## Database Changes (Migration)

### 1. Add columns to `items` table

```sql
ALTER TABLE items ADD COLUMN world_drop boolean NOT NULL DEFAULT false;
ALTER TABLE items ADD COLUMN drop_weight integer NOT NULL DEFAULT 10;
```

Then set `world_drop = true` for all non-unique, non-soulbound equipment and consumables as a reasonable starting default. Admins can toggle individual items off later.

### 2. Add `loot_mode` column to `creatures` table

```sql
ALTER TABLE creatures ADD COLUMN loot_mode text NOT NULL DEFAULT 'legacy_table';
```

Valid values: `legacy_table`, `item_pool`, `salvage_only`

Then auto-populate based on existing data:
- Humanoid regulars/rares without boss rarity → `item_pool`
- Non-humanoid → `salvage_only`
- Bosses and creatures with inline loot_table entries → `legacy_table`

### 3. Create `loot_pool_config` table

A single-row configuration table for global pool rules:

| Column | Type | Default |
|--------|------|---------|
| id | integer (PK) | 1 |
| equip_level_min_offset | integer | -3 |
| equip_level_max_offset | integer | 0 |
| common_pct | integer | 80 |
| uncommon_pct | integer | 20 |
| consumable_drop_chance | numeric | 0.15 |
| consumable_level_min_offset | integer | -5 |
| consumable_level_max_offset | integer | 0 |

RLS: anyone can SELECT, admins can UPDATE.

## Server-Side Loot Resolution

### `processLootDrops` in `_shared/combat-resolver.ts`

Add a new loot queue entry type for pool-based drops. Extend `LootQueueEntry` with a `mode` field:

```typescript
interface LootQueueEntry {
  nodeId: string;
  lootTableId: string | null;
  itemId: string | null;
  creatureName: string;
  dropChance: number;
  mode: 'legacy' | 'item_pool';  // NEW
  creatureLevel?: number;         // NEW — needed for pool filtering
}
```

When `mode === 'item_pool'`:
1. Fetch `loot_pool_config` (single row, cacheable)
2. Roll rarity: 80% common, 20% uncommon (from config)
3. Query eligible items: `world_drop = true`, `rarity = rolled_rarity`, `level BETWEEN creature_level + min_offset AND creature_level + max_offset`, `item_type = 'equipment'`, not unique, not soulbound
4. Weighted random select by `drop_weight`
5. Separately roll consumable: if `Math.random() < consumable_drop_chance`, query eligible consumables with same level logic, pick by weight
6. Insert into `node_ground_loot`

### `handleCreatureKill` in `combat-tick/index.ts`

Update the loot-push section:

```
if (creature.loot_mode === 'item_pool') {
  lootQueue.push({ mode: 'item_pool', nodeId, ..., creatureLevel: creature.level, dropChance: creature.drop_chance ?? 0.5 });
} else if (creature.loot_table_id) {
  // existing legacy_table path
} else {
  // existing inline loot_table path
}
```

### `combat-catchup/index.ts`

Same branching logic for offscreen DoT kills.

### Client-side `rollLoot` in `useCombatActions.ts`

Add the `item_pool` path that queries items directly:
- Roll rarity, filter by level/world_drop/weight, pick item
- Separate consumable roll
- Insert ground loot

### Client-side `pushCreatureLoot` in `combat-resolver.ts`

Update to pass `mode` and `creatureLevel` in the loot queue entry based on `creature.loot_mode`.

## Admin UI: Loot Management Page

Replace the existing `LootTableManager` component content with a tabbed interface. The component file stays the same to avoid routing changes.

### Tab 1: Pool Rules

- **Creature Type Defaults**: display which loot modes apply (humanoid → item_pool + gold, creature → salvage_only)
- **Equipment Pool Config**: editable fields for level offsets and rarity percentages (reads/writes `loot_pool_config`)
- **Consumable Pool Config**: drop chance, level offsets

### Tab 2: Item Pool Browser

- Table of all items showing: name, level, rarity, item_type, slot, world_drop toggle, drop_weight slider
- Filter by: item_type (equipment/consumable), rarity, level range, world_drop status
- Inline editing of `world_drop` and `drop_weight` per item
- Bulk toggle for world_drop

### Tab 3: Legacy Loot Tables

- The existing LootTableManager UI, preserved as-is
- Used for bosses and special encounters

### Tab 4: Creature Loot Modes

- List of creatures with their current `loot_mode`
- Filter by mode, rarity, humanoid
- Ability to change mode per creature or in bulk

## Files Modified

| File | Change |
|------|--------|
| Migration SQL | Add `world_drop`, `drop_weight` to items; `loot_mode` to creatures; create `loot_pool_config` |
| `supabase/functions/_shared/combat-resolver.ts` | Extend `LootQueueEntry`, add pool resolution in `processLootDrops` |
| `supabase/functions/combat-tick/index.ts` | Branch on `loot_mode` in `handleCreatureKill` |
| `supabase/functions/combat-catchup/index.ts` | Same branching for offscreen kills |
| `src/features/combat/utils/combat-resolver.ts` | Mirror `LootQueueEntry` changes |
| `src/features/combat/hooks/useCombatActions.ts` | Add `item_pool` path in `rollLoot` |
| `src/components/admin/LootTableManager.tsx` | Refactor into tabbed loot management page |
| `src/components/admin/CreatureManager.tsx` | Add `loot_mode` dropdown to creature edit form |

## What Does NOT Change

- Gold calculation system
- Salvage system for non-humanoid creatures
- Unique/soulbound item exclusivity
- Boss inline loot tables
- Manual loot table CRUD (preserved in Legacy tab)
- Combat architecture, tick timing, server authority

