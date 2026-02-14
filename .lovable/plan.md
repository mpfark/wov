

## Add "Humanoid" Toggle for Auto-Scaled Gold Drops

### Problem
Manually configuring gold min/max/chance for every humanoid creature is tedious. You want a quick way to flag a creature as humanoid so it automatically carries gold appropriate to its level.

### Solution
Add an **"Is Humanoid"** checkbox to the Creature Manager. When enabled, gold drop values are auto-calculated from the creature's level and rarity, removing the need to manually set them each time.

### How It Works

- A new `is_humanoid` column is added to the `creatures` table (boolean, default false)
- When the checkbox is toggled ON in the editor, gold min/max/chance fields are auto-filled using a formula based on level and rarity, and the fields become read-only (showing calculated values)
- When toggled OFF, the gold fields revert to manual entry (reset to 0)
- The auto-gold values scale like this:
  - **Min gold**: `level * 1` (multiplied by rarity: regular x1, rare x1.5, boss x3)
  - **Max gold**: `level * 3` (multiplied by rarity)
  - **Chance**: always `1.0` for humanoids (they always carry gold)

Example at level 10: regular humanoid drops 10-30 gold, rare drops 15-45, boss drops 30-90.

### Technical Details

1. **Database migration**: Add `is_humanoid boolean NOT NULL DEFAULT false` to the `creatures` table

2. **`src/lib/game-data.ts`**: Add a `calculateHumanoidGold(level, rarity)` function returning `{ min, max, chance }`

3. **`src/components/admin/CreatureManager.tsx`**:
   - Add `is_humanoid` to the form state
   - Add a checkbox labeled "Humanoid (auto gold)" next to the existing "Aggressive" checkbox
   - When `is_humanoid` is toggled on, auto-fill gold_min, gold_max, gold_chance from the formula and make those inputs disabled/read-only
   - When level or rarity changes while humanoid is on, recalculate gold values automatically
   - Persist `is_humanoid` to the database on save

4. **`src/hooks/useCombat.ts`** (or wherever loot is resolved): No changes needed -- gold is already read from the creature's `loot_table` at combat time, so the humanoid flag just affects how the loot_table is built in the admin editor.

