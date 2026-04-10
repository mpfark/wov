CREATE POLICY "Leaders can insert follower visited nodes"
ON public.character_visited_nodes
FOR INSERT
TO authenticated
WITH CHECK (
  owns_character(character_id)
  OR EXISTS (
    SELECT 1 FROM party_members pm
    JOIN parties p ON p.id = pm.party_id
    WHERE pm.character_id = character_visited_nodes.character_id
      AND pm.status = 'accepted'
      AND pm.is_following = true
      AND owns_character(p.leader_id)
  )
);