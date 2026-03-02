
-- Convert area_type column from enum to text
ALTER TABLE public.areas ALTER COLUMN area_type TYPE text USING area_type::text;
ALTER TABLE public.areas ALTER COLUMN area_type SET DEFAULT 'other';

-- Create area_types reference table
CREATE TABLE IF NOT EXISTS public.area_types (
  name text PRIMARY KEY,
  emoji text NOT NULL DEFAULT '📍',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed with existing types
INSERT INTO public.area_types (name, emoji) VALUES
  ('forest', '🌲'), ('town', '🏘️'), ('cave', '🕳️'), ('ruins', '🏚️'), ('plains', '🌾'),
  ('mountain', '⛰️'), ('swamp', '🌿'), ('desert', '🏜️'), ('coast', '🌊'), ('dungeon', '⚔️'), ('other', '📍')
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE public.area_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view area types" ON public.area_types FOR SELECT USING (true);
CREATE POLICY "Admins can manage area types" ON public.area_types FOR ALL USING (is_steward_or_overlord());
