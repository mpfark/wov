
-- Add main_hand and off_hand to item_slot enum
ALTER TYPE public.item_slot ADD VALUE IF NOT EXISTS 'main_hand';
ALTER TYPE public.item_slot ADD VALUE IF NOT EXISTS 'off_hand';

-- Add hands column to items (1 = one-handed, 2 = two-handed, NULL = not a weapon/shield)
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS hands smallint DEFAULT NULL;
