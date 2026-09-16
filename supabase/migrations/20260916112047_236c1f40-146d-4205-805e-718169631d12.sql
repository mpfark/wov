CREATE OR REPLACE FUNCTION public.combat2_movement_scope_eligible(_origin uuid,_destination uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.combat2_test_arena_node o
   JOIN public.combat2_test_arena a ON a.id=o.arena_id AND a.active
   JOIN public.combat2_test_arena_node d ON d.arena_id=o.arena_id AND d.active
   WHERE o.node_id=_origin AND o.active AND d.node_id=_destination
 ) OR (
   public.combat2_node_runtime_eligible(_origin)
   AND public.combat2_node_runtime_eligible(_destination)
 )
$$;
REVOKE ALL ON FUNCTION public.combat2_movement_scope_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_movement_scope_eligible(uuid,uuid) TO service_role;