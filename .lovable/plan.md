

## Predefined Loot Tables

### Current System
Each creature has an inline `loot_table` JSON array where every entry rolls independently. A creature with 5 items at 10% each can drop 0, 1, 2, or even all 5. Tables are duplicated per creature and can't be shared.

### Proposed System
Create named **Loot Tables** that are shared, reusable pools of items. When a creature dies:
1. Roll once to see if loot drops at all (based on a `drop_chance` on the creature)
2. If yes, pick **one item** from the table using weighted random selection

### Database Changes

**New table: `loot_tables`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | e.g. "Forest Beasts Lvl 1-5", "Goblin Warriors" |
| created_at | timestamptz | default now() |

**New table: `loot_table_entries`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| loot_table_id | uuid | FK to loot_tables |
| item_id | uuid | FK to items |
| weight | integer | Higher = more likely to be picked (default 10) |

**Creatures table changes:**
- Add `loot_table_id` (uuid, nullable, FK to loot_tables)
- Add `drop_chance` (numeric, default 0.5 -- 50% chance to drop anything)
- Keep existing `loot_table` JSON column for backward compatibility / gold config

When a creature has a `loot_table_id`, the new system is used. The old inline JSON remains for gold drops only.

### How Weighted Selection Works

If a loot table has:
- Iron Sword (weight 10)
- Steel Shield (weight 5)  
- Rare Ring (weight 1)

Total weight = 16. Iron Sword has 62.5% chance, Shield 31.25%, Ring 6.25%. The creature rolls once and drops exactly one of these (or nothing if the initial `drop_chance` roll fails).

### Code Changes

1. **New admin component: `LootTableManager.tsx`**
   - List/create/edit/delete loot tables
   - Add/remove items with weight sliders
   - Show calculated drop percentages
   - Accessible from Admin page as a new tab

2. **Update `CreatureManager.tsx`**
   - Add a loot table selector dropdown (pick from predefined tables)
   - Add a `drop_chance` slider (0-100%)
   - Keep gold drop config as-is (still inline)

3. **Update `rollLoot` in `GamePage.tsx`**
   - If creature has `loot_table_id`: fetch entries, do weighted random pick of one item
   - If creature has old inline `loot_table`: use existing logic (backward compatible)
   - Gold drops still processed from inline JSON

4. **Update `NodeEditorPanel.tsx` creature section**
   - Replace inline loot picker with loot table selector + drop chance

5. **Update `WorldBuilderPanel.tsx`**
   - AI-generated creatures reference loot tables instead of inline items

### Technical Details

**Weighted selection algorithm (in rollLoot):**
```text
1. Fetch loot_table_entries for creature's loot_table_id
2. Roll Math.random() against creature's drop_chance -- if fail, no drop
3. Sum all weights, pick random number 0..totalWeight
4. Walk entries, subtracting weight until <= 0 -- that's the picked item
5. Drop that single item to ground loot
```

**Admin tab addition in AdminPage.tsx:**
- Add "Loot Tables" tab between Items and Users

**CreatureManager changes:**
- Dropdown to select a loot table (or "None")
- Numeric input for drop_chance (0.0 - 1.0)
- Preview showing items in the selected table with their % chances

