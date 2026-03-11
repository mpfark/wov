CREATE POLICY "Users can update own visited nodes"
ON public.character_visited_nodes
FOR UPDATE
TO authenticated
USING (owns_character(character_id))
WITH CHECK (owns_character(character_id));