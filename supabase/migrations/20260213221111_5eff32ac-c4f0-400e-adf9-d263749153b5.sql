
-- Create NPCs table
CREATE TABLE public.npcs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dialogue TEXT NOT NULL DEFAULT '',
  node_id UUID REFERENCES public.nodes(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.npcs ENABLE ROW LEVEL SECURITY;

-- SELECT: any authenticated user
CREATE POLICY "Anyone can view npcs"
  ON public.npcs FOR SELECT
  USING (true);

-- INSERT: admins only
CREATE POLICY "Admins can insert npcs"
  ON public.npcs FOR INSERT
  WITH CHECK (is_maiar_or_valar());

-- UPDATE: admins only
CREATE POLICY "Admins can update npcs"
  ON public.npcs FOR UPDATE
  USING (is_maiar_or_valar());

-- DELETE: admins only
CREATE POLICY "Admins can delete npcs"
  ON public.npcs FOR DELETE
  USING (is_maiar_or_valar());

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.npcs;
