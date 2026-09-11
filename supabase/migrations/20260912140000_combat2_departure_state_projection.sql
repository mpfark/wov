-- Safe reconnect projection for the current user's own latest departure.
CREATE OR REPLACE FUNCTION public.combat2_departure_state(_character_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT CASE WHEN NOT public.owns_character(_character_id)
  THEN jsonb_build_object('ok',false,'kind','not_authorized')
  ELSE COALESCE((SELECT jsonb_build_object('ok',true,'kind','departure_state',
    'request_id',d.request_id,'status',d.status,'origin_node_id',d.origin_node_id,
    'destination_node_id',d.destination_node_id)
   FROM public.combat2_departure_request d WHERE d.character_id=_character_id
   ORDER BY d.created_at DESC,d.request_id DESC LIMIT 1),
   jsonb_build_object('ok',true,'kind','departure_state','status','none')) END;
$$;
REVOKE ALL ON FUNCTION public.combat2_departure_state(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_departure_state(uuid) TO authenticated,service_role;
