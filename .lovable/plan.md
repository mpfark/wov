

# Item Stat Budget System

## Overview

Add a `level` field to items and enforce a stat point budget based on level and rarity, with per-stat caps to prevent stacking. Admins see a live budget meter when editing items and cannot save over-budget items.

## Budget Formula

```text
Budget = floor(level * 0.3 * rarity_multiplier)

Rarity multipliers:
  common:   1.0x
  uncommon: 1.5x
  rare:     2.0x
  unique:   3.0x

Examples (Level 40):
  common:   floor(40 * 0.3 * 1.0) = 12 points
  uncommon: floor(40 * 0.3 * 1.5) = 18 points
  rare:     floor(40 * 0.3 * 2.0) = 24 points
  unique:   floor(40 * 0.3 * 3.0) = 36 points
```

## Stat Costs and Per-Item Caps

```text
Stat       Cost    Max per item
------     ----    ------------
STR         1        +5
DEX         1        +5
CON         1        +5
INT         1        +5
WIS         1        +5
CHA         1        +5
AC          3        +3
HP          0.5      +10
```

## Changes

### 1. Database Migration

Add `level` column to `items` table with a default of 1 and a range constraint (1-100).

### 2. `src/lib/game-data.ts` -- New Functions and Constants

- `ITEM_RARITY_MULTIPLIER` -- rarity to multiplier map
- `ITEM_STAT_COSTS` -- cost per stat point (AC=3, HP=0.5, others=1)
- `ITEM_STAT_CAPS` -- max value per stat per item (AC=3, HP=10, others=5)
- `getItemStatBudget(level, rarity)` -- returns the total budget
- `calculateItemStatCost(stats)` -- returns the weighted cost of current stats
- `getItemStatCap(statKey)` -- returns the cap for a given stat

### 3. `src/components/admin/ItemManager.tsx` -- UI and Validation

- Add `level` to the `Item` interface and form state (default 1)
- Add level number input (1-100) in the properties panel
- Add a budget indicator bar showing `used / total` points, colored green when under budget, red when over
- Clamp stat inputs to their per-stat cap (e.g., AC input max=3, HP input max=10, others max=5)
- On save, validate total cost does not exceed budget; show error toast if over
- Show level in the item list row

### Files Changed

| File | Change |
|---|---|
| Migration SQL | Add `level` column (integer, default 1, range 1-100) to `items` |
| `src/lib/game-data.ts` | Add budget/cost/cap constants and helper functions |
| `src/components/admin/ItemManager.tsx` | Add level field, budget indicator, stat caps, save validation |

