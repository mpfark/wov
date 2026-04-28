CREATE OR REPLACE FUNCTION public.get_renown_leaderboard(_limit integer DEFAULT 25)
RETURNS TABLE (
  id uuid,
  name text,
  level integer,
  class text,
  rp_total_earned integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.name, c.level, c.class::text, c.rp_total_earned
  FROM public.characters c
  WHERE c.rp_total_earned > 0
  ORDER BY c.rp_total_earned DESC, c.level DESC, c.name ASC
  LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

CREATE OR REPLACE FUNCTION public.get_renown_rank(_character_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 1 + COUNT(*)::int
  FROM public.characters c
  WHERE c.rp_total_earned > COALESCE(
    (SELECT rp_total_earned FROM public.characters WHERE id = _character_id),
    0
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_renown_leaderboard(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_renown_rank(uuid) TO authenticated;