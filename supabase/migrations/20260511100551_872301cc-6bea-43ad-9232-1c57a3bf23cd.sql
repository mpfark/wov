REVOKE EXECUTE ON FUNCTION public.add_material(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_material(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_material(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_material(uuid, text, integer) TO service_role;