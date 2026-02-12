
-- Allow party leaders to insert inventory items for party members (loot distribution)
DROP POLICY IF EXISTS "Owners can insert inventory" ON public.character_inventory;
CREATE POLICY "Owners or party leaders can insert inventory"
  ON public.character_inventory FOR INSERT
  WITH CHECK (
    owns_character(character_id)
    OR EXISTS (
      SELECT 1 FROM party_members pm
      JOIN parties p ON p.id = pm.party_id
      WHERE pm.character_id = character_id
        AND pm.status = 'accepted'
        AND owns_character(p.leader_id)
    )
  );
