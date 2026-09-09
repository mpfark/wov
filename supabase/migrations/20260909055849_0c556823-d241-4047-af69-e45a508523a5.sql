-- Server-authoritative search and five-minute shared hidden-path openings.
CREATE TABLE public.hidden_connection_opening (
  origin_node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  destination_node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  direction text NOT NULL,
  opened_until timestamptz NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(origin_node_id, destination_node_id, direction)
);
ALTER TABLE public.hidden_connection_opening ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.hidden_connection_opening FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.hidden_connection_opening TO service_role;

CREATE TABLE public.hidden_path_search_request (
  request_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  origin_node_id uuid NOT NULL REFERENCES public.nodes(id),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.hidden_path_search_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.hidden_path_search_request FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.hidden_path_search_request TO service_role;

CREATE OR REPLACE FUNCTION public.hidden_connection_is_open(
  _origin_node_id uuid, _destination_node_id uuid, _direction text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.hidden_connection_opening o
  WHERE o.origin_node_id=_origin_node_id AND o.destination_node_id=_destination_node_id
    AND o.direction=_direction AND o.opened_until>clock_timestamp());
$$;
REVOKE ALL ON FUNCTION public.hidden_connection_is_open(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hidden_connection_is_open(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.hidden_path_search(_character_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE c public.characters; prior public.hidden_path_search_request; chosen jsonb; v_result jsonb;
 roll integer; until_at timestamptz; focus_cost constant integer:=5;
BEGIN
 IF auth.uid() IS NULL OR NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('hidden_path_search:'||_request_id::text,0));
 SELECT * INTO prior FROM public.hidden_path_search_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.character_id<>_character_id THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN COALESCE(prior.result,jsonb_build_object('ok',false,'kind','request_pending'));
 END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF c.id IS NULL OR c.current_node_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF c.hp<=0 THEN RETURN jsonb_build_object('ok',false,'kind','unavailable_while_dead'); END IF;
 IF c.movement_locked_until IS NOT NULL AND c.movement_locked_until>clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'kind','movement_pending'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_departure_request d WHERE d.character_id=c.id AND d.status='queued')
  OR EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id
    WHERE f.character_id=c.id AND f.present AND e.status='active')
  THEN RETURN jsonb_build_object('ok',false,'kind','unavailable_while_in_combat'); END IF;
 SELECT conn INTO chosen FROM public.nodes n CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.connections,'[]')) conn
  WHERE n.id=c.current_node_id AND COALESCE((conn->>'hidden')::boolean,false)
    AND NULLIF(conn->>'node_id','') IS NOT NULL AND NULLIF(conn->>'direction','') IS NOT NULL
  ORDER BY random() LIMIT 1;
 IF chosen IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','nothing_to_find'); END IF;
 IF COALESCE(c.cp,0)<focus_cost THEN RETURN jsonb_build_object('ok',false,'kind','insufficient_focus'); END IF;
 INSERT INTO public.hidden_path_search_request(request_id,character_id,origin_node_id) VALUES(_request_id,c.id,c.current_node_id);
 UPDATE public.characters SET cp=cp-focus_cost WHERE id=c.id AND cp>=focus_cost;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='search_focus_fence_failed'; END IF;
 roll:=floor(random()*20)::integer+1;
 IF roll>=10 THEN
  until_at:=clock_timestamp()+interval '5 minutes';
  INSERT INTO public.hidden_connection_opening(origin_node_id,destination_node_id,direction,opened_until)
   VALUES(c.current_node_id,(chosen->>'node_id')::uuid,chosen->>'direction',until_at)
   ON CONFLICT(origin_node_id,destination_node_id,direction) DO UPDATE
    SET opened_until=GREATEST(hidden_connection_opening.opened_until,excluded.opened_until),opened_at=clock_timestamp();
  v_result:=jsonb_build_object('ok',true,'kind','found','direction',chosen->>'direction',
    'destination_node_id',chosen->>'node_id','opened_until',until_at,'focus_cost',focus_cost,'focus',c.cp-focus_cost);
 ELSE
  v_result:=jsonb_build_object('ok',true,'kind','not_found','focus_cost',focus_cost,'focus',c.cp-focus_cost);
 END IF;
 UPDATE public.hidden_path_search_request SET result=v_result WHERE request_id=_request_id;
 RETURN v_result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','search_failed');
END $$;
REVOKE ALL ON FUNCTION public.hidden_path_search(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hidden_path_search(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.hidden_path_openings(_character_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT CASE WHEN auth.uid() IS NULL OR NOT public.owns_character(_character_id) THEN
  jsonb_build_object('ok',false,'kind','not_authorized') ELSE
  jsonb_build_object('ok',true,'kind','openings','server_time',clock_timestamp(),
   'connections',COALESCE((SELECT jsonb_agg(jsonb_build_object('destination_node_id',o.destination_node_id,
    'direction',o.direction,'opened_until',o.opened_until) ORDER BY o.direction,o.destination_node_id)
    FROM public.characters c JOIN public.hidden_connection_opening o ON o.origin_node_id=c.current_node_id
    WHERE c.id=_character_id AND c.hp>0 AND o.opened_until>clock_timestamp()),'[]'::jsonb)) END;
$$;
REVOKE ALL ON FUNCTION public.hidden_path_openings(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.hidden_path_openings(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.player_world_nodes() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE COALESCE(jsonb_agg(
  to_jsonb(n) || jsonb_build_object('has_hidden_connections',EXISTS(
   SELECT 1 FROM jsonb_array_elements(COALESCE(n.connections,'[]'::jsonb)) hidden_conn
   WHERE COALESCE((hidden_conn->>'hidden')::boolean,false)),
   'connections',COALESCE((
   SELECT jsonb_agg(conn ORDER BY conn->>'direction',conn->>'node_id')
   FROM jsonb_array_elements(COALESCE(n.connections,'[]'::jsonb)) conn
   WHERE NOT COALESCE((conn->>'hidden')::boolean,false) OR EXISTS(
    SELECT 1 FROM public.characters c JOIN public.hidden_connection_opening o ON o.origin_node_id=c.current_node_id
    WHERE c.user_id=auth.uid() AND c.hp>0 AND c.current_node_id=n.id
      AND o.destination_node_id=(conn->>'node_id')::uuid AND o.direction=conn->>'direction'
      AND o.opened_until>clock_timestamp())),'[]'::jsonb)) ORDER BY n.id),'[]'::jsonb) END
 FROM public.nodes n;
$$;
REVOKE ALL ON FUNCTION public.player_world_nodes() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.player_world_nodes() TO authenticated,service_role;

-- Patch both installed departure contracts at their existing validation point.
DO $patch$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.combat2_depart(uuid,uuid,uuid)'::regprocedure) INTO d;
 IF position($old$IF COALESCE((v_connection->>'hidden')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden');
  END IF;$old$ in d)=0 THEN RAISE EXCEPTION 'unexpected combat2_depart hidden contract'; END IF;
 d:=replace(d,$old$IF COALESCE((v_connection->>'hidden')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden');
  END IF;$old$,$new$IF COALESCE((v_connection->>'hidden')::boolean,false) AND NOT public.hidden_connection_is_open(
    v_character.current_node_id,_destination_node_id,v_connection->>'direction') THEN
    RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden');
  END IF;$new$);
 EXECUTE d;

 SELECT pg_get_functiondef('public.combat2_party_depart(uuid,uuid,uuid)'::regprocedure) INTO d;
 IF position($old$IF COALESCE((conn->>'hidden')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden'); END IF;$old$ in d)=0
  THEN RAISE EXCEPTION 'unexpected combat2_party_depart hidden contract'; END IF;
 d:=replace(d,$old$IF COALESCE((conn->>'hidden')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden'); END IF;$old$,
  $new$IF COALESCE((conn->>'hidden')::boolean,false) AND NOT public.hidden_connection_is_open(
   leader.current_node_id,_destination_node_id,conn->>'direction') THEN RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden'); END IF;$new$);
 EXECUTE d;
END $patch$;