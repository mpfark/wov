
## Fix AI World Builder + Item Forge to Use the Shared Loot Table System

### The Problem

The runtime loot resolver (`rollLoot` in `GamePage.tsx`, lines 838–907) supports two paths:

**Path 1 — Shared Loot Table (the "new" system):**
- Checks `creature.loot_table_id` — if set, queries `loot_table_entries` for weighted items
- Controlled by the Loot Table Manager

**Path 2 — Legacy inline JSON (fallback):**
- If `loot_table_id` is null, reads `creature.loot_table` column (a raw JSON array of `[{ item_id, chance }]`)
- Items are hidden from the Loot Table Manager, not shared, not editable

The AI World Builder (`applyAll` in `WorldBuilderPanel.tsx`, lines 253–283) always writes to the **legacy path**: it builds a `creatureLootMap` of `{ item_id, chance }` entries and inserts them into `creatures.loot_table`. It never creates a `loot_tables` row or a `loot_table_entries` row, and it never sets `loot_table_id` on the creature.

The proposed Item Forge was also planned to follow this same pattern.

This means AI-generated creatures' loot is invisible to the Loot Table Manager and can't be edited or shared.

---

### The Fix

Change the World Builder's `applyAll` function — and the future Item Forge's apply step — to write through the **shared loot table system** instead of the legacy inline column.

**New apply logic for AI-generated creatures with items:**

For each batch of items belonging to a set of creatures from the same generation run, the apply step will:

1. Create one shared `loot_tables` row per creature that has items (name: `"[Creature Name] Drops"`)
2. Insert `loot_table_entries` rows for each item (using real item IDs and weights derived from `drop_chance`)
3. Update the creature's `loot_table_id` to point to the new shared table
4. Update the creature's `drop_chance` to the highest item's drop_chance from the generation
5. Leave `creatures.loot_table` as `[]` (empty, not used)

This means every AI-generated creature's loot becomes visible and editable in the Loot Table Manager immediately after apply.

**Weight conversion:** The AI generates `drop_chance` as a float (0.1–0.5). To convert to a weight integer for `loot_table_entries`, multiply by 100 and round. For example: `drop_chance: 0.3` → `weight: 30`.

---

### Files to Change

**`src/components/admin/WorldBuilderPanel.tsx`** — the `applyAll` function:

Replace the current `creatureLootMap` + inline loot_table insert pattern (lines 254–283 and 383–398) with:

```
for each creature that has items:
  1. supabase.from('loot_tables').insert({ name: `${creature.name} Drops` }) → lootTableId
  2. for each item in creatureLootMap[creature.temp_id]:
       supabase.from('loot_table_entries').insert({ loot_table_id: lootTableId, item_id, weight: Math.round(item.chance * 100) })
  3. creature insert uses: loot_table_id: lootTableId, drop_chance: maxDropChance, loot_table: []
     (instead of: loot_table: lootEntries)
```

Creatures with no items are inserted with `loot_table_id: null`, `drop_chance: 0`, `loot_table: []` — unchanged from current behaviour.

---

### What Does NOT Change

- The runtime `rollLoot` function in `GamePage.tsx` — no changes needed. It already correctly handles `loot_table_id` (shared system) and falls back to the inline JSON. Once the World Builder writes to the right place, the right path is taken automatically.
- The `LootTableManager.tsx` component — no changes needed. New tables will appear there naturally.
- The edge function `ai-world-builder/index.ts` — the AI output schema stays the same. Only the frontend `applyAll` changes how it persists the data.
- The proposed Item Forge edge function — when it gets built, it will use the same new pattern from day one.

---

### Technical Detail: Populate Mode

In populate mode (lines 264–291), creatures are inserted with their real node IDs directly. The same fix applies — for each creature with items, create a loot table row and entries, then set `loot_table_id` on the creature instead of writing `loot_table: lootEntries`.

---

### Files to Edit

- `src/components/admin/WorldBuilderPanel.tsx` — modify `applyAll` to create `loot_tables` + `loot_table_entries` rows and set `loot_table_id` on creatures instead of writing inline JSON.

No database migrations needed — the `loot_tables`, `loot_table_entries`, `creatures.loot_table_id`, and `creatures.drop_chance` columns all already exist.
