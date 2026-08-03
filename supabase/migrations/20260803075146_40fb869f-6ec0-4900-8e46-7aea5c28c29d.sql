ALTER TABLE public.abilities DROP COLUMN IF EXISTS emoji;
ALTER TABLE public.classes DROP COLUMN IF EXISTS icon;
ALTER TABLE public.materials DROP COLUMN IF EXISTS icon;

-- area_types.emoji is superseded by area_types.color (added in the expand phase).
ALTER TABLE public.area_types DROP COLUMN IF EXISTS emoji;