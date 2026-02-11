
-- Add last_online to characters for Return Rule tracking
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS last_online timestamp with time zone NOT NULL DEFAULT now();

-- Function to return unique items from offline players (24h) back to creature loot
-- This is called periodically or on game actions
CREATE OR REPLACE FUNCTION public.return_unique_items()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete unique items from characters who have been offline for 24+ hours
  DELETE FROM public.character_inventory
  WHERE id IN (
    SELECT ci.id
    FROM public.character_inventory ci
    JOIN public.items i ON ci.item_id = i.id
    JOIN public.characters c ON ci.character_id = c.id
    WHERE i.rarity = 'unique'
      AND c.last_online < now() - interval '24 hours'
  );
  
  -- Also delete destroyed unique items (durability <= 0)
  DELETE FROM public.character_inventory
  WHERE id IN (
    SELECT ci.id
    FROM public.character_inventory ci
    JOIN public.items i ON ci.item_id = i.id
    WHERE i.rarity = 'unique'
      AND ci.current_durability <= 0
  );
END;
$$;

-- Vendor items table for stocking vendor nodes
CREATE TABLE IF NOT EXISTS public.vendor_inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  price integer NOT NULL DEFAULT 10,
  stock integer NOT NULL DEFAULT -1, -- -1 means infinite
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view vendor inventory"
ON public.vendor_inventory FOR SELECT USING (true);

CREATE POLICY "Admins can manage vendor inventory"
ON public.vendor_inventory FOR ALL USING (is_maiar_or_valar());
