

## Searchable Entity Pickers Across Admin UI

### Problem
The NodePicker pattern works well for nodes, but all other entity selectors (items, creatures, loot tables, NPCs) still use flat `<Select>` dropdowns with no search capability. As the database grows, finding specific items, creatures, or loot tables becomes painful.

### Solution
Create two new reusable searchable picker components following the NodePicker pattern, then replace flat dropdowns across the admin UI.

### New Components

**1. `ItemPicker.tsx`** — Searchable item selector
- Groups items by rarity (Unique, Uncommon, Common)
- Shows: item name, level, rarity color, slot type
- Search by name
- Props: `items`, `value`, `onChange`, `placeholder?`, `allowNone?`, `excludeIds?`, `filterSlot?`

**2. `CreaturePicker.tsx`** — Searchable creature selector
- Groups by rarity (Boss, Rare, Regular)
- Shows: creature name, level, rarity, assigned/unassigned status
- Search by name
- Props: `creatures`, `value`, `onChange`, `placeholder?`, `allowNone?`

**3. `LootTablePicker.tsx`** — Searchable loot table selector
- Flat list (no grouping needed, smaller dataset), but with search
- Shows: table name, item count if available
- Props: `tables`, `value`, `onChange`, `placeholder?`, `allowNone?`

### Files to Update

| File | Selector | Replacement |
|------|----------|-------------|
| **ItemPickerList.tsx** | Item `<Select>` per loot entry | `ItemPicker` |
| **LootTableManager.tsx** | Item `<Select>` per weighted entry | `ItemPicker` |
| **CreatureManager.tsx** | Loot table `<Select>` | `LootTablePicker` |
| **NodeEditorPanel.tsx** | Creature assign `<Select>` | `CreaturePicker` |
| **NodeEditorPanel.tsx** | NPC assign `<Select>` — small list, skip for now |
| **NodeEditorPanel.tsx** | Vendor item `<Select>` | `ItemPicker` |
| **NodeEditorDialog.tsx** | Same patterns as NodeEditorPanel | Same replacements |
| **ItemForgePanel.tsx** | Creature assign `<Select>` | `CreaturePicker` |
| **RaceClassManager.tsx** | Starting weapon `<Select>` | `ItemPicker` (filtered to weapons) |
| **RaceClassManager.tsx** | Universal gear slot `<Select>` | `ItemPicker` (filtered by slot) |
| **UserManager.tsx** | Gift item `<Select>` | `ItemPicker` |
| **UserManager.tsx** | Teleport node `<Select>` | `NodePicker` (already exists) |
| **UserManager.tsx** | Remove item `<Select>` — character-specific inventory, skip |

### What stays as flat `<Select>`
- Enum selectors (rarity, category, role, status, area type, region filter) — small fixed lists, no search needed
- NPC assign in NodeEditorPanel — typically very few unassigned NPCs

### Summary
- **3 new components** created (ItemPicker, CreaturePicker, LootTablePicker)
- **~10 flat dropdowns** replaced with searchable pickers
- All follow the same Popover + Command pattern as NodePicker

