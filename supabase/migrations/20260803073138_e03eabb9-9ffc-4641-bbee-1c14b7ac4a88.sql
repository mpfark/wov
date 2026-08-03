ALTER TABLE public.area_types
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '200 15 50';

-- Normalize/validate the stored HSL triplet. Malformed values fall back to neutral.
CREATE OR REPLACE FUNCTION public.normalize_area_type_color()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parts text[];
  h numeric;
  s numeric;
  l numeric;
BEGIN
  NEW.color := btrim(coalesce(NEW.color, ''));
  parts := regexp_split_to_array(NEW.color, '\s+');

  IF array_length(parts, 1) IS DISTINCT FROM 3
     OR parts[1] !~ '^[0-9]+(\.[0-9]+)?$'
     OR parts[2] !~ '^[0-9]+(\.[0-9]+)?$'
     OR parts[3] !~ '^[0-9]+(\.[0-9]+)?$'
  THEN
    NEW.color := '200 15 50';
    RETURN NEW;
  END IF;

  h := parts[1]::numeric;
  s := parts[2]::numeric;
  l := parts[3]::numeric;

  IF h < 0 OR h > 360 OR s < 0 OR s > 100 OR l < 0 OR l > 100 THEN
    NEW.color := '200 15 50';
    RETURN NEW;
  END IF;

  NEW.color := round(h)::text || ' ' || round(s)::text || ' ' || round(l)::text;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS area_types_normalize_color ON public.area_types;
CREATE TRIGGER area_types_normalize_color
  BEFORE INSERT OR UPDATE ON public.area_types
  FOR EACH ROW EXECUTE FUNCTION public.normalize_area_type_color();

-- Backfill: preserve each existing area type's current map colour exactly.
UPDATE public.area_types SET color = v.color
FROM (VALUES
  ('forest',   '120 40 45'),
  ('town',     '35 50 55'),
  ('cave',     '260 30 50'),
  ('ruins',    '20 30 45'),
  ('plains',   '60 40 50'),
  ('mountain', '210 20 55'),
  ('swamp',    '120 40 45'),
  ('desert',   '40 55 55'),
  ('coast',    '195 50 50'),
  ('dungeon',  '0 35 45'),
  ('other',    '200 15 50'),
  ('trail',    '200 15 50'),
  ('camp',     '200 15 50'),
  ('hideout',  '200 15 50'),
  ('castle',   '35 50 55')
) AS v(name, color)
WHERE public.area_types.name = v.name;