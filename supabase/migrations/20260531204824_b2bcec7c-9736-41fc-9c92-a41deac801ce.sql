-- 1. Drop the trigger and its function so clearing illustration_url actually sticks.
DROP TRIGGER IF EXISTS trg_areas_fill_placeholder ON public.areas;
DROP FUNCTION IF EXISTS public.areas_fill_placeholder();

-- 2. Scrub placeholder URLs out of areas so admin sees real empty state.
UPDATE public.areas
SET
  illustration_url = NULL,
  illustration_metadata = COALESCE(illustration_metadata, '{}'::jsonb)
    - 'is_placeholder' - 'source'
WHERE illustration_metadata->>'is_placeholder' = 'true';

-- 3. Keep public.area_type_placeholder_url(text) — frontend fallback still uses it conceptually.
