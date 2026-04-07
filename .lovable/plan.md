

# Add Inventory Tab to Character Panel

## Summary

Split the CharacterPanel from 2 tabs into 3 tabs: **Equipment**, **Inventory**, **Attributes**. The Equipment tab keeps equipped gear, belt potions, consumables, and quest items. The new Inventory tab gets all other unequipped items (equipment pieces). Also limit tooltip widths globally so long descriptions don't span the screen.

## Changes

### 1. CharacterPanel.tsx — Add 3rd tab and split inventory

**Tab structure:**
- **Equipment** — Equipment slots grid, belt potions, consumables (unequipped items where `item_type === 'consumable'`), quest items (if any `item_type === 'quest'`)
- **Inventory** — All other unequipped bag items (equipment, salvage, etc.) with sort controls, carry weight, equip/drop/pin actions
- **Attributes** — Unchanged

**Splitting logic:**
```typescript
const consumableAndQuestItems = bagItems.filter(i => 
  i.item.item_type === 'consumable' || i.item.item_type === 'quest'
);
const inventoryItems = bagItems.filter(i => 
  i.item.item_type !== 'consumable' && i.item.item_type !== 'quest'
);
```

The Equipment tab will show a compact consumables/quest section below belt potions (reusing existing item row rendering). The Inventory tab gets the current bag list minus consumables/quest, plus the sort button and weight display.

**TabsList** becomes 3 triggers with slightly smaller text to fit.

### 2. Tooltip max-width constraint

Add `max-w-xs` (320px) to all `TooltipContent` elements in CharacterPanel that show item info. Several already have it (line 555); apply consistently to:
- EquipSlot tooltip (line 114)
- Belt potion tooltips (line 458)
- All inventory item tooltips

This caps tooltip width at 320px so long descriptions wrap instead of spanning the screen.

## Files Modified

| File | Change |
|------|--------|
| `src/features/character/components/CharacterPanel.tsx` | Add "Inventory" tab, move equipment bag items there, keep consumables/quest on Equipment tab, ensure all item tooltips have `max-w-xs` |

## What Does NOT Change

- Attributes tab content
- Equipment slot grid layout
- Belt potion system
- Item actions (equip, drop, pin, destroy)
- Sort functionality (moves to Inventory tab)

