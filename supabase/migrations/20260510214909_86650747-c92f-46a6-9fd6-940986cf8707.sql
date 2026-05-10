
CREATE TABLE public.character_gems (
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  gem_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, gem_key),
  CHECK (count >= 0)
);

ALTER TABLE public.character_gems ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view gems"
  ON public.character_gems
  FOR SELECT
  USING (public.owns_character(character_id) OR public.is_steward_or_overlord());

CREATE POLICY "Service role full access on character_gems"
  ON public.character_gems
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER PUBLICATION supabase_realtime ADD TABLE public.character_gems;
ALTER TABLE public.character_gems REPLICA IDENTITY FULL;
