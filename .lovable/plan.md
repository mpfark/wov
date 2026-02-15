

# Belt Potion System

## Overview
Belts will serve as potion holders for combat. Players can only use potions that are "loaded" into their belt, and can only load potions onto the belt while out of combat. Potions in the regular inventory are stored but not usable during fights.

## How It Works

1. **Belt Slots**: When a belt is equipped, it unlocks a number of potion slots (e.g., based on belt stats or a fixed number like 3). Without a belt, no potions can be used in combat.

2. **Loading Potions**: While out of combat, the player can move consumable potions from their inventory into belt slots. This is a UI-only concept -- we track which inventory items are "belted" via a new field.

3. **Combat Restriction**: During combat, only belted potions show the "Use" (heart) button. Regular inventory potions hide the use button. Loading/unloading potions is blocked while in combat.

4. **Belt UI**: A new small section appears in the Character Panel below the equipment grid showing the belt's potion slots with the loaded potions and use/remove buttons.

## Technical Details

### Database Change
- Add a `belt_slot` smallint column (nullable) to `character_inventory` table. When set (1, 2, 3...), the potion is loaded in that belt slot. NULL means it's just in the bag.

### Belt Capacity
- Each belt item will use a new stat key `potion_slots` in its `stats` JSON (e.g., `{"potion_slots": 3, "con": 1}`). Default to 3 if a belt is equipped but has no explicit value. No belt equipped = 0 slots.

### Code Changes

**`src/hooks/useInventory.ts`**
- Add a `beltPotion` / `unbeltPotion` function to set/clear the `belt_slot` column on a consumable inventory row.
- Expose `beltedPotions` (inventory items where `belt_slot IS NOT NULL` and item_type = consumable).
- Expose `beltCapacity` derived from the equipped belt's `potion_slots` stat.

**`src/components/game/CharacterPanel.tsx`**
- Add a "Belt Potions" section below the equipment grid showing occupied belt slots.
- Each slot shows the potion name with a Use button (heart icon) and an Unload button.
- Empty slots show an "Empty" placeholder.
- When out of combat: show a "Load" button next to consumable potions in the inventory to assign them to an open belt slot.
- When in combat: hide Load/Unload buttons; only show Use on belted potions.
- Hide the existing Use (heart) button on non-belted consumables.

**`src/pages/GamePage.tsx`**
- Pass `inCombat` state down to `CharacterPanel` so it can conditionally show/hide load/unload/use buttons.
- Update `handleUseConsumable` to work as before (it already takes an inventoryId).

### Existing belt item update
- Update the existing "An Iron Belt" item's stats JSON to include `"potion_slots": 3` via a migration.

