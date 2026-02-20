

# Ground Loot System -- Drop Items on the Ground Instead of Direct Distribution

## Overview

Replace the current loot assignment/round-robin system with a "ground loot" model. When a creature dies, its loot drops onto the ground at that node. Any party member present can pick items up. Players can also drop items from their inventory onto the ground for others to grab.

## How It Works

1. **Creature dies** -- loot rolls happen as before, but instead of inserting into `character_inventory`, items are inserted into a new `node_ground_loot` table tied to the node.
2. **NodeView shows ground loot** -- a new collapsible section "On the Ground" displays dropped items. Each item has a "Pick Up" button.
3. **Pick up** -- clicking it moves the item from `node_ground_loot` into `character_inventory` for that character. Unique items still use the `try_acquire_unique_item` RPC.
4. **Drop to ground** -- the existing `dropItem` function (currently deletes the item permanently) is changed to move items to `node_ground_loot` instead, so other players can pick them up.
5. **Cleanup** -- ground loot expires after a configurable time (e.g. 10 minutes) to prevent clutter. A database function handles this.

## What Gets Removed

- **LootShareDialog** -- no longer needed since loot goes to ground instead of being assigned by the leader.
- **Round-robin logic** in `rollLoot` -- replaced with simple inserts into `node_ground_loot`.
- **`pendingLoot` state** in GamePage -- no longer needed.

## Database Changes

### New table: `node_ground_loot`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | Default `gen_random_uuid()` |
| node_id | uuid (NOT NULL) | FK to nodes |
| item_id | uuid (NOT NULL) | FK to items |
| dropped_by | uuid | Character who dropped it (null for creature drops) |
| dropped_at | timestamptz | Default `now()`, used for expiration |
| creature_name | text | For display ("Loot from Goblin") |

### RLS Policies
- **SELECT**: Anyone authenticated can view ground loot (items are visible to all at a node).
- **INSERT**: Authenticated users can insert (for dropping items).
- **DELETE**: Authenticated users can delete (for picking up items -- delete from ground, insert into inventory).

### Realtime
- Enable realtime on `node_ground_loot` so all players at the node see drops/pickups instantly.

### Cleanup function
- `cleanup_ground_loot()`: Deletes rows older than 10 minutes. Called periodically (can piggyback on existing cron-like mechanisms or be called client-side).

---

## Technical Details

### File: New migration
- Create `node_ground_loot` table with columns above.
- Add RLS policies.
- Enable realtime.
- Create `cleanup_ground_loot()` function.

### File: New hook `src/hooks/useGroundLoot.ts`
- Subscribes to `node_ground_loot` filtered by the current `node_id`.
- Provides `groundLoot` array, `pickUpItem(groundLootId)`, and `dropItemToGround(inventoryId)` functions.
- `pickUpItem`: Deletes from `node_ground_loot`, inserts into `character_inventory` (with unique item guard).
- `dropItemToGround`: Deletes from `character_inventory`, inserts into `node_ground_loot` at the character's current node.

### File: `src/pages/GamePage.tsx`
- Import and use `useGroundLoot(character.current_node_id, character.id)`.
- Remove `pendingLoot` state, `handleLootDistribute`, and `LootShareDialog` rendering.
- Update `rollLoot` to insert drops into `node_ground_loot` instead of `character_inventory`.
- Pass `groundLoot`, `onPickUp`, `onDropToGround` to `NodeView`.

### File: `src/components/game/NodeView.tsx`
- Add a new "On the Ground" collapsible section (similar to "In the Area").
- Each item shows name (colored by rarity), creature source if any, and a "Pick Up" button.

### File: `src/hooks/useInventory.ts`
- Change `dropItem` to call the ground loot hook's drop function instead of permanently deleting the item. (Or expose both options: "Drop" puts on ground, "Destroy" permanently removes.)

### File: `src/components/game/CharacterPanel.tsx`
- Update the "Drop" button behavior to drop to ground instead of destroy.
- Optionally add a "Destroy" option for when players want to permanently remove junk.

### File: `src/components/game/LootShareDialog.tsx`
- Remove this file entirely (no longer needed).

