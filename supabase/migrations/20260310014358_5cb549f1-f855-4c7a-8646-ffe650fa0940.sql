
CREATE OR REPLACE FUNCTION public.find_character_id_by_name(_name text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT id FROM characters WHERE lower(name) = lower(_name) LIMIT 1
$$;
