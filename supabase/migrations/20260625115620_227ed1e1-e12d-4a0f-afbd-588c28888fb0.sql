CREATE OR REPLACE FUNCTION public.get_my_admin_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'overlord') THEN 'overlord'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'steward') THEN 'steward'
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()) THEN 'player'
    ELSE NULL
  END
$$;

GRANT EXECUTE ON FUNCTION public.get_my_admin_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_admin_role() TO anon;