ALTER TYPE public.item_slot ADD VALUE IF NOT EXISTS 'ring_2';

DELETE FROM public.character_inventory
WHERE equipped_slot IN ('amulet','shoulders','belt','boots');

ALTER TABLE public.character_inventory DROP COLUMN IF EXISTS belt_slot;