
-- Create character_visited_nodes table
CREATE TABLE public.character_visited_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  first_visited_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (character_id, node_id)
);

-- Enable RLS
ALTER TABLE public.character_visited_nodes ENABLE ROW LEVEL SECURITY;

-- Players can view their own visited nodes
CREATE POLICY "Users can view own visited nodes"
ON public.character_visited_nodes
FOR SELECT
TO authenticated
USING (owns_character(character_id));

-- Players can insert their own visited nodes
CREATE POLICY "Users can insert own visited nodes"
ON public.character_visited_nodes
FOR INSERT
TO authenticated
WITH CHECK (owns_character(character_id));

-- Admins can view all
CREATE POLICY "Admins can view all visited nodes"
ON public.character_visited_nodes
FOR SELECT
TO authenticated
USING (is_steward_or_overlord());
