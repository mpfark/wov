

# AI World Builder: Auto-Generate Items for Humanoid Creatures

## Overview
Extend the populate nodes AI to also generate loot items (equipment and consumables) for humanoid creatures. Only humanoids will receive items, with a maximum of 1-2 pieces each. Generated items will be inserted into the `items` table, then linked to the creature's `loot_table` using real item IDs.

## Current State
- The AI generates creatures with a `loot_table` using `item_name` strings, but these are never linked to actual items in the database
- The game's real loot system uses `{ item_id: UUID, chance: number }` references to the `items` table
- There is no item generation in the populate flow

## Changes

### 1. Edge Function: Add `items` array to AI tool schema
**File:** `supabase/functions/ai-world-builder/index.ts`

- Add a new `items` array to the `generate_world` tool parameters with fields: `temp_id`, `name`, `description`, `item_type` (equipment/consumable only), `rarity`, `slot`, `level`, `stats`, `value`, `max_durability`, `hands`, `creature_temp_ids` (which creatures carry this item)
- Update the populate prompt rules to instruct:
  - Only humanoid creatures can carry items
  - Max 1-2 items per humanoid
  - Only generate `equipment` and `consumable` types (no trash loot)
  - Items must be level-appropriate for the region
  - Item stats must follow the stat budget system (explained in prompt)
  - Mark each creature as `is_humanoid: true/false` so the AI knows which ones qualify
- Add `is_humanoid` to the creature schema so the AI can flag humanoids
- Fetch existing items to provide context and avoid name duplication

### 2. Edge Function: Update system prompt with item rules
**File:** `supabase/functions/ai-world-builder/index.ts`

Add item generation rules to the system prompt:
- Items follow the stat budget: `floor(level * 0.3 * rarity_multiplier * hands_multiplier)`
- Rarity multipliers: common (1.0), uncommon (1.5), rare (2.0), unique (3.0)
- Valid equipment slots: main_hand, off_hand, head, chest, legs, feet, hands, belt, ring, neck, back, ammo
- Consumables should be potions or food with hp/hp_regen stats
- Max durability: 50-100 for common, 75-150 for uncommon, 100-200 for rare
- Gold value suggestion: level * 2.5 * rarity_multiplier^2

### 3. Frontend: Apply generated items during populate
**File:** `src/components/admin/WorldBuilderPanel.tsx`

Update the apply logic for populate mode:
- First insert all generated items into the `items` table, collecting their real UUIDs
- Map `creature_temp_ids` to build each creature's `loot_table` as `{ item_id: realUUID, chance: number }`
- Set `is_humanoid` on creatures during insert
- Display item count in the success toast

### 4. Frontend: Show generated items in preview
**File:** `src/components/admin/WorldBuilderPreviewGraph.tsx`

- Add item counts per creature/node to the hover tooltip so admins can see what items were generated before applying
- Show a small item indicator on humanoid creature nodes

### 5. Edge Function: Update new region and expand modes too
**File:** `supabase/functions/ai-world-builder/index.ts`

Apply the same item generation capability to "new region" and "expand" modes (not just populate), so humanoid creatures in newly generated regions also come with appropriate loot.

## Technical Details

**New tool schema field (`items` array):**
```json
{
  "temp_id": "item_1",
  "name": "Iron Shortsword",
  "description": "A well-forged blade...",
  "item_type": "equipment",
  "rarity": "common",
  "slot": "main_hand",
  "level": 5,
  "hands": 1,
  "stats": { "str": 2, "dex": 1 },
  "value": 12,
  "max_durability": 80,
  "creature_temp_ids": ["creature_1"],
  "drop_chance": 0.3
}
```

**Apply flow:**
1. Insert each item into `items` table, get real UUID
2. Build a map: creature_temp_id -> [{ item_id, chance }]
3. When inserting creatures, merge the mapped loot entries into the creature's `loot_table`

**Files modified:**
- `supabase/functions/ai-world-builder/index.ts` -- item schema, prompt rules, is_humanoid
- `src/components/admin/WorldBuilderPanel.tsx` -- apply logic for items
- `src/components/admin/WorldBuilderPreviewGraph.tsx` -- item preview in tooltips

