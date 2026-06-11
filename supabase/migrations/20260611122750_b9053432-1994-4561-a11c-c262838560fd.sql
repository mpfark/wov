CREATE OR REPLACE FUNCTION public.get_order_roster(_class public.character_class)
RETURNS TABLE (
  character_id uuid,
  name text,
  family_name text,
  level integer,
  class public.character_class,
  bond integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.family_name, c.level, c.class, b.bond
  FROM public.character_class_bonds b
  JOIN public.characters c ON c.id = b.character_id
  WHERE b.class = _class
    AND b.bond > 0
  ORDER BY b.bond DESC, c.level DESC, c.name ASC
  LIMIT 200
$$;

GRANT EXECUTE ON FUNCTION public.get_order_roster(public.character_class) TO authenticated;