REVOKE EXECUTE ON FUNCTION public.encounter_end_participation(uuid, uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.characters_end_participation_on_node_change() FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_end_participation(uuid, uuid) TO service_role;