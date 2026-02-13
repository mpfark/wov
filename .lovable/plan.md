

# Unique Items, Loot Fallback, and Blacksmith System

## Overview

Three interconnected features:
1. **Unique item exclusivity** -- creatures/search nodes drop a common fallback if the unique item is already held by someone
2. **Unique item return** -- items return to their origin (creature loot table or search node) when durability hits 0 or owner is offline 24h (already partially handled by `return_unique_items` DB function, but needs origin tracking)
3. **Blacksmith nodes** -- a new node type where players can repair items for gold

---

## 1. Database Changes

### `items` table -- add `origin_type` and `origin_id`

Track where a unique item "belongs" so it can return there:

```text
origin_type  TEXT  nullable  (values: 'creature' or 'node')
origin_id    UUID  nullable  (the creature ID or node ID it originates from)
```

These are only meaningful for unique-rarity items. Set by admins when configuring loot tables/searchable items.

### `nodes` table -- add `is_blacksmith` boolean

```text
is_blacksmith  BOOLEAN  default false
```

### Admin World Map marker

Add a hammer icon for blacksmith nodes, similar to vendor/inn markers.

---

## 2. Unique Item Drop Logic

### Creature loot (`GamePage.tsx` -- `rollLoot`)

When rolling loot and an item is `unique` rarity:
- Query `character_inventory` to check if **any** player currently holds that `item_id`
- If held: skip the drop (log "The unique power of [item] is already claimed...")
- If not held: drop normally

### Node search (`GamePage.tsx` -- `handleSearch`)

Same check for searchable items with unique rarity -- if already held by anyone, skip.

---

## 3. Unique Item Return (Origin Tracking)

### `return_unique_items()` DB function update

The existing function already deletes unique items from offline (24h) players and broken items. No code change needed there -- items are simply deleted, making them available again.

The loot/search logic above already checks if anyone holds the item, so once deleted the item becomes droppable again from its original creature or search node.

### `degradeEquipment` in `GamePage.tsx`

When a unique item breaks (durability reaches 0), log a special message: "Your [item name] shatters and its essence returns to [origin]..."

---

## 4. Blacksmith System

### Node property (`is_blacksmith`)

- Admin can toggle "Is Blacksmith" on any node (like vendor/inn)
- Shown in NodeView with a hammer icon and "Repair your equipment here" text

### Repair pricing formula

```text
repairCost = ceil((maxDurability - currentDurability) * itemValue * rarityMult / 100)

rarityMult: common=1, uncommon=1.5, rare=2, unique=0 (unrepairable)
```

Unique items cannot be repaired -- they are meant to break and return.

### Blacksmith UI (`NodeView.tsx`)

When at a blacksmith node, show a "Open Blacksmith" button (like vendor). Opens a `BlacksmithPanel` dialog listing equipped and unequipped items with:
- Current durability bar
- Repair cost
- "Repair" button (disabled if full durability, unique, or not enough gold)
- "Repair All" button for convenience

### `BlacksmithPanel.tsx` (new component)

Dialog similar to `VendorPanel`:
- Lists all inventory items with durability < max
- Shows repair cost per item
- Repair updates `current_durability` to `max_durability` and deducts gold
- Unique items shown grayed out with "Unrepairable" label

---

## 5. Admin UI Changes

### `NodeEditorPanel.tsx`

- Add "Is Blacksmith" checkbox alongside "Is Vendor" and "Is Inn"

### `AdminWorldMapView.tsx`

- Add hammer icon for blacksmith nodes on the map

### `ItemManager.tsx` (optional enhancement)

- For unique items, show `origin_type` and `origin_id` fields so admins can link the item to its source creature or node

---

## Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `origin_type`, `origin_id` to `items`; add `is_blacksmith` to `nodes` |
| `src/hooks/useNodes.ts` | Add `is_blacksmith` to `GameNode` interface |
| `src/pages/GamePage.tsx` | Update `rollLoot` and `handleSearch` to check unique ownership; add blacksmith dialog state |
| `src/components/game/NodeView.tsx` | Show blacksmith button and indicator |
| `src/components/game/BlacksmithPanel.tsx` | New component for repair UI |
| `src/components/admin/NodeEditorPanel.tsx` | Add blacksmith checkbox |
| `src/components/admin/AdminWorldMapView.tsx` | Add blacksmith marker |
| `src/components/admin/ItemManager.tsx` | Add origin fields for unique items |
| `src/lib/game-data.ts` | Add `calculateRepairCost` helper |

