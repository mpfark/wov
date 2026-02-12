-- Allow party leaders to update follower characters' current_node_id
DROP POLICY IF EXISTS "Users can update own characters" ON public.characters;

CREATE POLICY "Users can update own characters"
  ON public.characters FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM party_members pm
      JOIN parties p ON p.id = pm.party_id
      WHERE pm.character_id = characters.id
        AND pm.status = 'accepted'
        AND pm.is_following = true
        AND owns_character(p.leader_id)
    )
  );