REVOKE EXECUTE ON FUNCTION public.return_unique_items() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_unique_items() FROM anon;
REVOKE EXECUTE ON FUNCTION public.return_unique_items() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.return_unique_items() TO service_role;