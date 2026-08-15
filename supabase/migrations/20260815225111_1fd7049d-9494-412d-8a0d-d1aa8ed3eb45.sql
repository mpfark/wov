REVOKE EXECUTE ON FUNCTION public.combat_validation_grant_check(text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.combat_validation_grant_check(text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.combat_validation_grant_check(text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.combat_validation_grant_check(text, uuid, text) TO service_role;
