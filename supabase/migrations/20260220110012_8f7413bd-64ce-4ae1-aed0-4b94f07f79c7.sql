
-- Create ground loot table
CREATE TABLE public.node_ground_loot (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  dropped_by uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  dropped_at timestamptz NOT NULL DEFAULT now(),
  creature_name text
);

-- Enable RLS
ALTER TABLE public.node_ground_loot ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view ground loot"
  ON public.node_ground_loot FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert ground loot"
  ON public.node_ground_loot FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete ground loot"
  ON public.node_ground_loot FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.node_ground_loot;

-- Cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_ground_loot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.node_ground_loot
  WHERE dropped_at < now() - interval '10 minutes';
END;
$$;
