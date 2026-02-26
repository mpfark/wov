
-- 1. Create area_type enum
CREATE TYPE public.area_type AS ENUM ('forest', 'town', 'cave', 'ruins', 'plains', 'mountain', 'swamp', 'desert', 'coast', 'dungeon', 'other');

-- 2. Create areas table
CREATE TABLE public.areas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  area_type public.area_type NOT NULL DEFAULT 'other',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- 3. Add area_id to nodes (nullable, no FK constraint for flexibility)
ALTER TABLE public.nodes ADD COLUMN area_id uuid;

-- 4. Change nodes.name default to empty string (keep NOT NULL)
ALTER TABLE public.nodes ALTER COLUMN name SET DEFAULT '';

-- 5. Enable RLS on areas
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

-- 6. RLS: Public read
CREATE POLICY "Anyone can view areas" ON public.areas FOR SELECT USING (true);

-- 7. RLS: Admin-only write
CREATE POLICY "Admins can insert areas" ON public.areas FOR INSERT WITH CHECK (is_steward_or_overlord());
CREATE POLICY "Admins can update areas" ON public.areas FOR UPDATE USING (is_steward_or_overlord());
CREATE POLICY "Admins can delete areas" ON public.areas FOR DELETE USING (is_steward_or_overlord());

-- 8. Enable realtime for areas
ALTER PUBLICATION supabase_realtime ADD TABLE public.areas;
