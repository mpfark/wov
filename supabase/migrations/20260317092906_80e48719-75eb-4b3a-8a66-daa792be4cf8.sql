
-- Drop the flawed INSERT policy and replace with owner-only
DROP POLICY "Owners or party leaders can insert inventory" ON public.character_inventory;

CREATE POLICY "Owners can insert inventory" ON public.character_inventory
FOR INSERT TO authenticated
WITH CHECK (owns_character(character_id));
