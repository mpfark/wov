
-- 1. Add columns to items table
ALTER TABLE public.items ADD COLUMN world_drop boolean NOT NULL DEFAULT false;
ALTER TABLE public.items ADD COLUMN drop_weight integer NOT NULL DEFAULT 10;

-- 2. Add loot_mode column to creatures table
ALTER TABLE public.creatures ADD COLUMN loot_mode text NOT NULL DEFAULT 'legacy_table';

-- 3. Create loot_pool_config table
CREATE TABLE public.loot_pool_config (
  id integer PRIMARY KEY DEFAULT 1,
  equip_level_min_offset integer NOT NULL DEFAULT -3,
  equip_level_max_offset integer NOT NULL DEFAULT 0,
  common_pct integer NOT NULL DEFAULT 80,
  uncommon_pct integer NOT NULL DEFAULT 20,
  consumable_drop_chance numeric NOT NULL DEFAULT 0.15,
  consumable_level_min_offset integer NOT NULL DEFAULT -5,
  consumable_level_max_offset integer NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the single config row
INSERT INTO public.loot_pool_config (id) VALUES (1);

-- Enable RLS
ALTER TABLE public.loot_pool_config ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view
CREATE POLICY "Anyone can view loot pool config"
  ON public.loot_pool_config FOR SELECT
  USING (true);

-- Only admins can update
CREATE POLICY "Admins can update loot pool config"
  ON public.loot_pool_config FOR UPDATE
  USING (is_steward_or_overlord());

-- 4. Auto-populate world_drop for non-unique, non-soulbound items
UPDATE public.items
SET world_drop = true
WHERE rarity != 'unique'
  AND is_soulbound = false
  AND (item_type = 'equipment' OR item_type = 'consumable');

-- 5. Auto-populate loot_mode on creatures
-- Non-humanoid → salvage_only
UPDATE public.creatures
SET loot_mode = 'salvage_only'
WHERE is_humanoid = false;

-- Humanoid non-bosses → item_pool
UPDATE public.creatures
SET loot_mode = 'item_pool'
WHERE is_humanoid = true
  AND rarity != 'boss';

-- Bosses stay as legacy_table (already default)
-- Creatures with existing loot_table_id stay as legacy_table
UPDATE public.creatures
SET loot_mode = 'legacy_table'
WHERE loot_table_id IS NOT NULL
  OR (loot_table::text != '[]' AND loot_table::text != 'null');
