REVOKE ALL ON FUNCTION public.apply_force_shield_regen(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.apply_force_shield_regen(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.activate_stance(uuid, text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.activate_stance(uuid, text, integer) TO authenticated;