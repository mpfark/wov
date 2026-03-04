

## Inventory Carry Capacity & Encumbrance System

### Concept

Players get a **carry capacity** derived from STR. They can hold more items than this limit, but each move costs extra MP proportional to how over-encumbered they are.

### Formula

```text
Carry Capacity = 12 + STR_modifier (minimum 10)
  - e.g. STR 14 → mod +2 → capacity 14
  - e.g. STR 8  → mod -1 → capacity 11 (clamped to 10)

Items Over = max(0, inventory_count - capacity)

Move Cost = 10 + (items_over * 5) MP
```

STR modifier includes equipment bonuses (already tracked via `equipmentBonuses`).

### Changes

1. **`src/lib/game-data.ts`** — Add `getCarryCapacity(str)` and `getMoveCost(inventoryCount, str)` functions.

2. **`src/pages/GamePage.tsx`** — In `handleMove`:
   - Replace hardcoded `10` MP cost with `getMoveCost(inventory.length, effectiveStr)`.
   - Update the "too exhausted" check to use the dynamic cost.
   - Show a warning log when over-encumbered (e.g. "⚠️ You are over-encumbered! Movement costs X MP.").

3. **`src/components/game/StatusBarsStrip.tsx`** — Update the MP tooltip to show current move cost instead of fixed "10 MP" when encumbered.

4. **`src/components/game/CharacterPanel.tsx`** — Show carry capacity indicator (e.g. "Items: 14/12 ⚠️") in the inventory section header.

5. **`src/components/admin/GameManual.tsx`** — Add encumbrance rules to the Stamina section.

### What stays the same
- Players are never blocked from picking up items
- Base move cost remains 10 MP when at or under capacity
- MP regen is unchanged

