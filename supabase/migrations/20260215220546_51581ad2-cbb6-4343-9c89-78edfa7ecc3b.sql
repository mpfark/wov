
-- Add belt_slot column to character_inventory
ALTER TABLE public.character_inventory ADD COLUMN belt_slot smallint NULL;

-- Update "An Iron Belt" to include potion_slots in stats
UPDATE public.items SET stats = stats || '{"potion_slots": 3}'::jsonb WHERE name = 'An Iron Belt' AND slot = 'belt';
