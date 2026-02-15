

# Stat-Based HP Regen + Item Regen Bonus

## Balance Design

Currently, HP regen is a flat **1 HP per 30 seconds**, multiplied by Inn (3x) and potion/bard buffs. We'll add a stat-based component using **CON** (constitution -- the natural choice for physical recovery):

**Formula**: `base_regen = 1 + floor((CON - 10) / 4)`

- CON 8-13: 1 HP/tick (same as now for low-level characters)
- CON 14-17: 2 HP/tick
- CON 18-21: 3 HP/tick
- CON 22-25: 4 HP/tick
- CON 26-29: 5 HP/tick
- CON 30: 6 HP/tick

This scales gently -- a high-CON Dwarf Warrior (CON ~12 at creation) starts the same but grows with levels. The multipliers from Inns, potions, and Bard still stack on top.

## Item Regen Bonus

Items can also add regen via a new `hp_regen` stat key in their stats JSON. For example, a ring might have `{"hp_regen": 1, "con": 1}`. This adds flat HP per tick before multipliers are applied.

**Formula with items**: `total_base = (1 + floor((CON - 10) / 4) + equipped_hp_regen) * multipliers`

## Changes

### 1. Game Data (`src/lib/game-data.ts`)
- Add `hp_regen` to `ITEM_STAT_COSTS` (cost: 2 points -- strong but not broken)
- Add `hp_regen` to `ITEM_STAT_CAPS` (cap: 3 per item)
- Add a `getBaseRegen(con: number)` helper function

### 2. Regen Logic (`src/pages/GamePage.tsx`)
- Update the regen interval to calculate `base_regen` from character CON using the formula
- Sum `hp_regen` from all equipped items' stats
- Use `(base_regen + item_regen) * totalMult` instead of `1 * totalMult`
- Pass the computed base regen and item regen values to CharacterPanel for display

### 3. Regen Tooltip (`src/components/game/CharacterPanel.tsx`)
- Update the HP bar tooltip to show the breakdown:
  - "Base (CON): X HP"
  - "Gear: +Y HP" (if any equipped items have hp_regen)
  - Multiplier lines (Inn, Potion) as before
  - "Total: Z HP every 30s"

### 4. Item Manager (`src/components/admin/ItemManager.tsx`)
- Add `hp_regen` as a configurable stat in the item editor (alongside str, dex, etc.)
- Display it with label "HP Regen" so admins can set it on any equipment piece

### 5. Item Display (`src/components/game/CharacterPanel.tsx`)
- When rendering item stat badges in inventory/equipment, show `hp_regen` with a distinct style (e.g., green/elvish color) labeled as "+X Regen"

