REVOKE EXECUTE ON FUNCTION public.combat_soak_access_check(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.combat_soak_access_check(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.combat_soak_access_check(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.combat_soak_access_check(uuid, uuid) TO service_role;