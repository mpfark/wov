

## Pool-Based Blacksmith Forge System

### Overview
Replace the per-forge AI call with a pre-generated item pool. Admins use the existing Item Forge to batch-create items tagged with `origin_type = 'forge_pool'`. When a player forges, the edge function randomly picks a level-appropriate item from the pool, clones it into the `items` table as their personal copy, and adds it to inventory.

### Database Changes

**New table: `forge_pool`**
Stores pre-generated template items available for the blacksmith to draw from. Separated from `items` to keep pool management clean.

```sql
CREATE TABLE public.forge_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  slot item_slot NOT NULL,
  rarity item_rarity NOT NULL DEFAULT 'common',
  level integer NOT NULL DEFAULT 1,
  hands smallint,
  stats jsonb NOT NULL DEFAULT '{}',
  value integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.forge_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view forge pool" ON public.forge_pool FOR SELECT USING (true);
CREATE POLICY "Admins can manage forge pool" ON public.forge_pool FOR ALL USING (is_steward_or_overlord());
```

### Edge Function: `blacksmith-forge` (rewrite)

Replace AI generation with pool lookup:
1. Authenticate user, verify ownership, verify at blacksmith node
2. Deduct salvage & gold costs (same formula: salvage = 5 + level*2, gold = level*5)
3. Roll rarity (65% common, 35% uncommon)
4. Query `forge_pool` for matching items: same slot, same rarity, level within ±2 of character level
5. Pick one at random; if pool is empty for that combo, fall back to ±5 level range, then error if still empty
6. Clone the pool item into `items` table with `origin_type = 'blacksmith_forge'`
7. Add to `character_inventory`, return result

This eliminates AI latency, API costs, and rate-limit issues entirely.

### Admin: Item Forge Integration

Update `ItemForgePanel.tsx` to add a third forge mode: `'forge_pool'` alongside existing `'single'` and `'loot_table'` modes.

When mode is `forge_pool`:
- The "Apply" action inserts generated items into `forge_pool` table instead of `items`
- No loot table name needed
- Show current pool stock counts by level/slot in the right panel

### Admin: Pool Stock Overview

Add a small stock summary in the Item Forge panel when `forge_pool` mode is selected, showing counts grouped by level range and slot so admins know where gaps exist.

### Client: `BlacksmithPanel.tsx`

Minimal changes:
- Same UI, same `supabase.functions.invoke('blacksmith-forge', ...)` call
- Remove the "forging..." delay expectation text if any (it'll be near-instant now)
- No other changes needed since the API contract stays the same

### Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create `forge_pool` table |
| `supabase/functions/blacksmith-forge/index.ts` | Rewrite: pool lookup instead of AI |
| `src/components/admin/ItemForgePanel.tsx` | Add `forge_pool` mode + stock view |
| `src/integrations/supabase/types.ts` | Auto-updated after migration |

