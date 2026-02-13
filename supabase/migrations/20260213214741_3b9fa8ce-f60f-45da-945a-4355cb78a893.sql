
-- Add origin tracking to items for unique item return
ALTER TABLE public.items ADD COLUMN origin_type TEXT;
ALTER TABLE public.items ADD COLUMN origin_id UUID;

-- Add blacksmith flag to nodes
ALTER TABLE public.nodes ADD COLUMN is_blacksmith BOOLEAN NOT NULL DEFAULT false;
