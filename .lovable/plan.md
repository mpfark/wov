## Inventory Carry Capacity & Encumbrance System

### Concept

Players get a **carry capacity** derived from STR. They can hold more items than this limit, but each move costs extra MP proportional to how over-encumbered they are.

### Weight System

- **Equipment** items count as **1 slot** each
- **Consumables** count as **⅓ slot** each (rounded up total)
- **Equipped items** and **belted potions** don't count toward weight

### Formula

```text
Carry Capacity = 12 + STR_modifier (minimum 10)
  - e.g. STR 14 → mod +2 → capacity 14
  - e.g. STR 8  → mod -1 → capacity 11 (clamped to 10)

Bag Weight = ceil(equipment_count * 1 + consumable_count * 0.33)

Weight Over = max(0, bag_weight - capacity)

Move Cost = 10 + (weight_over * 5) MP
```

STR modifier includes equipment bonuses (already tracked via `equipmentBonuses`).

### What stays the same
- Players are never blocked from picking up items
- Base move cost remains 10 MP when at or under capacity
- MP regen is unchanged
