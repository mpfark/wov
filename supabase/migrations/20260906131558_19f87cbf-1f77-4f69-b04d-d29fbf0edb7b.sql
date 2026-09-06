-- Authenticated, self-scoped activation check for the permanent Combat2 test arena.
CREATE OR REPLACE FUNCTION public.combat2_test_session_access(_character_id uuid,_node_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE arena_id uuid;
BEGIN
 SELECT n.arena_id INTO arena_id FROM public.combat2_test_arena_node n
 JOIN public.combat2_test_arena a ON a.id=n.arena_id AND a.active
 WHERE n.node_id=_node_id AND n.active;
 IF arena_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_test_node'); END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.user_id=auth.uid() AND c.current_node_id=_node_id)
   OR NOT public.combat2_test_arena_access_allowed(auth.uid(),_character_id,_node_id)
 THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 RETURN jsonb_build_object('ok',true,'kind','allowed','arena_id',arena_id,'node_id',_node_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','access_check_failed');
END; $$;
REVOKE ALL ON FUNCTION public.combat2_test_session_access(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_session_access(uuid,uuid) TO authenticated;