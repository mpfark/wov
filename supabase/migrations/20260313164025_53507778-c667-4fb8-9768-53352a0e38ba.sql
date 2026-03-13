
ALTER TABLE public.items ADD COLUMN is_soulbound boolean NOT NULL DEFAULT false;
ALTER TABLE public.characters ADD COLUMN soulforged_item_created boolean NOT NULL DEFAULT false;
