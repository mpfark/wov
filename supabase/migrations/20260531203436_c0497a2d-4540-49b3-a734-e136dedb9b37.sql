
-- 1) Move area-type-*.jpg files in background-images bucket into placeholders/ prefix
UPDATE storage.objects
SET name = 'placeholders/' || name
WHERE bucket_id = 'background-images'
  AND name LIKE 'area-type-%'
  AND name NOT LIKE 'placeholders/%';

-- 2) Helper: placeholder URL for a given area_type
CREATE OR REPLACE FUNCTION public.area_type_placeholder_url(_area_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/background-images/placeholders/area-type-'
         || COALESCE(NULLIF(_area_type, ''), 'other')
         || '.jpg';
$$;

-- 3) Trigger: when an area is inserted or its illustration is cleared,
--    auto-fill with the area-type placeholder and mark as placeholder.
CREATE OR REPLACE FUNCTION public.areas_fill_placeholder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.illustration_url IS NULL OR NEW.illustration_url = '' THEN
    NEW.illustration_url := public.area_type_placeholder_url(NEW.area_type);
    NEW.illustration_metadata := COALESCE(NEW.illustration_metadata, '{}'::jsonb)
      || jsonb_build_object('is_placeholder', true, 'source', 'area-type-fallback');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_areas_fill_placeholder ON public.areas;
CREATE TRIGGER trg_areas_fill_placeholder
BEFORE INSERT OR UPDATE OF illustration_url, area_type
ON public.areas
FOR EACH ROW
EXECUTE FUNCTION public.areas_fill_placeholder();

-- 4) Backfill existing areas:
--    a) rewrite old placeholder URLs (root or double-slash) to the new placeholders/ path
UPDATE public.areas
SET illustration_url = public.area_type_placeholder_url(area_type),
    illustration_metadata = COALESCE(illustration_metadata, '{}'::jsonb)
      || jsonb_build_object('is_placeholder', true, 'source', 'area-type-fallback')
WHERE illustration_url ILIKE '%/background-images/%area-type-%';

--    b) fill null/empty illustration_url with the area-type placeholder
UPDATE public.areas
SET illustration_url = public.area_type_placeholder_url(area_type),
    illustration_metadata = COALESCE(illustration_metadata, '{}'::jsonb)
      || jsonb_build_object('is_placeholder', true, 'source', 'area-type-fallback')
WHERE illustration_url IS NULL OR illustration_url = '';
