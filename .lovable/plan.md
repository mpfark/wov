
# Admin Character Sheet Mirror

## Overview
Rebuild the admin UserManager's middle column to visually mirror the player's CharacterPanel, showing the full character sheet (name, HP/XP bars, stats with Base +Gear and Mod, AC, Gold, equipment paper doll, and inventory) -- everything except party information. This requires both backend and frontend changes since the admin endpoint currently only fetches basic character fields.

## Changes

### 1. Update the admin-users edge function
- Expand the character SELECT to include all stat columns: `str, dex, con, int, wis, cha, ac, xp, unspent_stat_points`
- Add a second query to fetch `character_inventory` with joined `items` data for each user's characters
- Return inventory grouped by character ID alongside the existing character data

### 2. Update UserManager types
- Expand the `AdminUser.characters` interface to include all stat fields (`str, dex, con, int, wis, cha, ac, xp, unspent_stat_points`)
- Add an `inventory` array per character matching the `InventoryItem` shape (with nested `item` object)

### 3. Rebuild the middle column to mirror CharacterPanel
When a user is selected and has characters, render each character using the same visual layout as `CharacterPanel`:

- **Name and Identity** -- name, race/class label, level
- **HP Bar** -- colored progress bar (green/yellow/red thresholds)
- **XP Bar** -- progress toward next level
- **Attributes table** -- with "Stat / Base +Gear / Mod" headers and tooltips, calculating equipment bonuses from inventory data
- **AC and Gold row**
- **Equipment paper doll** -- 3-column grid with all 12 slots, showing equipped item names and durability (read-only, no unequip actions)
- **Inventory list** -- unequipped items with rarity colors and tooltips (read-only, no equip/drop actions)

The existing inline edit controls for HP, max_hp, gold, and level will be preserved and integrated into this new layout. The admin edit button will toggle inline inputs within the relevant sections (e.g., HP inputs appear in the HP bar area).

### 4. Reuse constants and helpers
Import from existing modules rather than duplicating:
- `STAT_LABELS`, `STAT_FULL_NAMES` (or define locally), `getStatModifier`, `RACE_LABELS`, `CLASS_LABELS` from `game-data.ts`
- `RARITY_COLORS`, `SLOT_LABELS` patterns from `CharacterPanel.tsx`
- Equipment bonus calculation logic from `useInventory.ts`

## Technical Details

### Edge function query changes
```sql
-- Characters: fetch all columns instead of subset
SELECT * FROM characters WHERE user_id IN (...)

-- Inventory: join with items table
SELECT ci.*, items.* FROM character_inventory ci
JOIN items ON ci.item_id = items.id
WHERE ci.character_id IN (...)
```

### Files modified
1. `supabase/functions/admin-users/index.ts` -- expand character + add inventory queries
2. `src/components/admin/UserManager.tsx` -- rebuild middle column with CharacterPanel layout
