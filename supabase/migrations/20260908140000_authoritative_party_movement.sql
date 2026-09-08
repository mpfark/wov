-- Durable coordinated movement for the existing parties/party_members model.
-- Lock order: party-lifecycle advisory -> request advisory -> origin-node advisory
-- -> encounter row -> character rows (UUID order) -> fighter rows (UUID order).

ALTER TABLE public.party_operation_request DROP CONSTRAINT party_operation_request_operation_check;
ALTER TABLE public.party_operation_request ADD CONSTRAINT party_operation_request_operation_check
  CHECK(operation IN('create','invite','accept','decline','cancel','leave','kick','disband','set_tank','follow','stop_following'));

DO $patch$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.party_mutate(uuid,text,uuid,uuid,uuid,uuid)'::regprocedure) INTO d;
 IF position($needle$IF _operation NOT IN('create','invite','accept','decline','cancel','leave','kick','disband','set_tank')$needle$ in d)=0
    OR position($needle$IF _operation='invite' THEN$needle$ in d)=0 THEN RAISE EXCEPTION 'unexpected party_mutate contract'; END IF;
 d:=replace(d,$needle$IF _operation NOT IN('create','invite','accept','decline','cancel','leave','kick','disband','set_tank')$needle$,
   $needle$IF _operation NOT IN('create','invite','accept','decline','cancel','leave','kick','disband','set_tank','follow','stop_following')$needle$);
 d:=replace(d,$needle$ IF _operation='invite' THEN$needle$,$body$
 IF _operation IN('follow','stop_following') THEN
  IF _party_id IS NULL OR _target_character_id IS NOT NULL OR _membership_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF p.leader_id=actor.id THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','leader_cannot_follow')); END IF;
  SELECT * INTO member FROM public.party_members WHERE party_id=p.id AND character_id=actor.id AND status='accepted' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','not_authorized')); END IF;
  IF public.party_combat_mutation_blocked(p.id,NULL)
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','combat_active')); END IF;
  UPDATE public.party_members SET is_following=(_operation='follow') WHERE id=member.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind',CASE WHEN _operation='follow' THEN 'following' ELSE 'not_following' END,'party_id',p.id));
 END IF;

 IF _operation='invite' THEN$body$);
 EXECUTE d;
END $patch$;

CREATE TABLE public.combat2_party_departure_request(
 request_id uuid PRIMARY KEY, caller_id uuid NOT NULL, leader_character_id uuid NOT NULL REFERENCES public.characters(id),
 party_id uuid NOT NULL REFERENCES public.parties(id), origin_node_id uuid NOT NULL REFERENCES public.nodes(id),
 destination_node_id uuid NOT NULL REFERENCES public.nodes(id), direction text NOT NULL,
 status text NOT NULL CHECK(status IN('queued','moved','completed')), result jsonb, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE TABLE public.combat2_party_departure_member(
 request_id uuid NOT NULL REFERENCES public.combat2_party_departure_request(request_id) ON DELETE CASCADE,
 character_id uuid NOT NULL REFERENCES public.characters(id), display_name text NOT NULL, movement_order integer NOT NULL,
 departure_request_id uuid NOT NULL UNIQUE, encounter_id uuid REFERENCES public.node_encounter(id), fighter_id uuid REFERENCES public.node_fighter(id),
 fighter_entry_seq bigint, arrival_group_id uuid REFERENCES public.node_arrival_group(id), cost integer NOT NULL CHECK(cost>=0),
 status text NOT NULL CHECK(status IN('waiting','queued','moved','dead','remaining')), resolved_tick integer, resolved_at timestamptz,
 PRIMARY KEY(request_id,character_id), UNIQUE(request_id,movement_order)
);
ALTER TABLE public.combat2_party_departure_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_party_departure_member ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.combat2_party_departure_request,public.combat2_party_departure_member FROM PUBLIC,anon,authenticated;
GRANT ALL PRIVILEGES ON public.combat2_party_departure_request,public.combat2_party_departure_member TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_party_departure_result(_request_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('ok',true,'kind',CASE r.status WHEN 'queued' THEN 'already_queued' ELSE 'already_moved' END,
  'request_id',r.request_id,'origin_node_id',r.origin_node_id,'destination_node_id',r.destination_node_id,'cost',0,'resource_kind','mp',
  'members',COALESCE(jsonb_agg(jsonb_build_object('character_id',m.character_id,'display_name',m.display_name,'order',m.movement_order,
   'status',m.status,'cost',m.cost) ORDER BY m.movement_order),'[]'::jsonb))
 FROM public.combat2_party_departure_request r JOIN public.combat2_party_departure_member m ON m.request_id=r.request_id
 WHERE r.request_id=_request_id GROUP BY r.request_id,r.status,r.origin_node_id,r.destination_node_id;
$$;
REVOKE ALL ON FUNCTION public.combat2_party_departure_result(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_party_departure_result(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_party_departure_finalize() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parent uuid; m public.combat2_party_departure_member; outcomes jsonb; did_move boolean;
BEGIN
 SELECT request_id INTO parent FROM public.combat2_party_departure_member WHERE departure_request_id=NEW.request_id;
 IF parent IS NULL THEN RETURN NEW; END IF;
 UPDATE public.combat2_party_departure_member SET status=NEW.status,resolved_tick=NEW.resolved_tick,resolved_at=NEW.resolved_at
  WHERE departure_request_id=NEW.request_id AND status='queued' AND NEW.status IN('moved','dead');
 IF EXISTS(SELECT 1 FROM public.combat2_party_departure_member WHERE request_id=parent AND status='queued') THEN RETURN NEW; END IF;
 FOR m IN SELECT * FROM public.combat2_party_departure_member WHERE request_id=parent AND status='waiting' ORDER BY movement_order FOR UPDATE LOOP
  PERFORM set_config('app.combat2_depart_authorized','true',true);
  UPDATE public.characters c SET current_node_id=r.destination_node_id,mp=c.mp-m.cost
   FROM public.combat2_party_departure_request r WHERE r.request_id=parent AND c.id=m.character_id
    AND c.current_node_id=r.origin_node_id AND c.hp>0 AND c.mp>=m.cost;
  did_move:=FOUND;
  UPDATE public.combat2_party_departure_member SET status=CASE WHEN did_move THEN 'moved' ELSE 'remaining' END,resolved_at=now()
   WHERE request_id=parent AND character_id=m.character_id;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('character_id',character_id,'display_name',display_name,'order',movement_order,'status',status,'cost',cost) ORDER BY movement_order)
  INTO outcomes FROM public.combat2_party_departure_member WHERE request_id=parent;
 UPDATE public.combat2_party_departure_request SET status='completed',result=outcomes,resolved_at=now() WHERE request_id=parent;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.combat2_party_departure_finalize() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_party_departure_finalize() TO service_role;
CREATE TRIGGER combat2_party_departure_member_finalized AFTER UPDATE OF status ON public.combat2_departure_request
 FOR EACH ROW WHEN (OLD.status='queued' AND NEW.status IN('moved','dead')) EXECUTE FUNCTION public.combat2_party_departure_finalize();

CREATE OR REPLACE FUNCTION public.combat2_party_depart(_leader_character_id uuid,_destination_node_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); leader public.characters; p public.parties; prior public.combat2_party_departure_request;
 conn jsonb; encounter public.node_encounter; mover record; fighter public.node_fighter; cap integer; bag numeric; cost integer;
 ordinal integer:=0; child uuid; event_id uuid; queued integer:=0; outcomes jsonb;
BEGIN
 IF caller IS NULL OR _leader_character_id IS NULL OR _destination_node_id IS NULL OR _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2_party_depart_request:'||_request_id::text,0));
 SELECT * INTO prior FROM public.combat2_party_departure_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.caller_id<>caller OR prior.leader_character_id<>_leader_character_id OR prior.destination_node_id<>_destination_node_id THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN public.combat2_party_departure_result(_request_id);
 END IF;
 SELECT * INTO leader FROM public.characters WHERE id=_leader_character_id AND user_id=caller;
 SELECT * INTO p FROM public.parties WHERE leader_id=_leader_character_id;
 IF leader.id IS NULL OR p.id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','leader_required'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||leader.current_node_id::text,0));
 SELECT * INTO encounter FROM public.node_encounter WHERE node_id=leader.current_node_id AND status='active' FOR UPDATE;
 IF encounter.claim_token IS NOT NULL AND encounter.claim_expires_at>now() THEN RETURN jsonb_build_object('ok',false,'kind','live_claim'); END IF;
 SELECT * INTO leader FROM public.characters WHERE id=_leader_character_id FOR UPDATE;
 SELECT cconn INTO conn FROM public.nodes n CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.connections,'[]')) cconn
  WHERE n.id=leader.current_node_id AND cconn->>'node_id'=_destination_node_id::text LIMIT 1;
 IF conn IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_adjacent'); END IF;
 IF COALESCE((conn->>'hidden')::boolean,false) THEN RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden'); END IF;
 IF COALESCE(conn->>'direction','')='' THEN RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','missing_direction'); END IF;

 -- Static all-or-none pass. Accepted followers are ordered by joined_at then character UUID; leader is forced last.
 FOR mover IN
  SELECT c.*,pm.joined_at,false leader_last FROM public.party_members pm JOIN public.characters c ON c.id=pm.character_id
   WHERE pm.party_id=p.id AND pm.status='accepted' AND pm.is_following AND c.id<>leader.id AND c.current_node_id=leader.current_node_id AND c.hp>0
  UNION ALL SELECT leader.*,NULL::timestamptz,true
  ORDER BY leader_last,joined_at,id
 LOOP
  PERFORM 1 FROM public.characters WHERE id=mover.id FOR UPDATE;
  IF COALESCE((conn->>'locked')::boolean,false) AND NOT EXISTS(SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=mover.id AND lower(i.name)=lower(COALESCE(conn->>'lock_key',''))) THEN
   RETURN jsonb_build_object('ok',false,'kind','missing_required_key','member',mover.name);
  END IF;
  cap:=GREATEST(12+FLOOR((COALESCE(mover.str,10)-10)/2.0)::int,10);
  SELECT COALESCE(SUM(CASE WHEN i.item_type='consumable' THEN 1.0/3.0 ELSE 1.0 END),0) INTO bag
   FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id WHERE ci.character_id=mover.id AND ci.equipped_slot IS NULL;
  cost:=5+GREATEST(0,CEIL(bag)::int-cap)*3;
  IF COALESCE(mover.mp,0)<cost THEN RETURN jsonb_build_object('ok',false,'kind','insufficient_resource','member',mover.name,'resource_kind','mp'); END IF;
  IF EXISTS(SELECT 1 FROM public.combat2_departure_request d WHERE d.character_id=mover.id AND d.status='queued') THEN
   RETURN jsonb_build_object('ok',false,'kind','movement_already_pending','member',mover.name); END IF;
 END LOOP;

 INSERT INTO public.combat2_party_departure_request VALUES(_request_id,caller,leader.id,p.id,leader.current_node_id,_destination_node_id,conn->>'direction','queued',NULL,now(),NULL);
 FOR mover IN
  SELECT c.*,pm.joined_at,false leader_last FROM public.party_members pm JOIN public.characters c ON c.id=pm.character_id
   WHERE pm.party_id=p.id AND pm.status='accepted' AND pm.is_following AND c.id<>leader.id AND c.current_node_id=leader.current_node_id AND c.hp>0
  UNION ALL SELECT leader.*,NULL::timestamptz,true ORDER BY leader_last,joined_at,id
 LOOP
  ordinal:=ordinal+1; child:=(substr(md5(_request_id::text||mover.id::text),1,8)||'-'||substr(md5(_request_id::text||mover.id::text),9,4)||'-4'||substr(md5(_request_id::text||mover.id::text),14,3)||'-8'||substr(md5(_request_id::text||mover.id::text),18,3)||'-'||substr(md5(_request_id::text||mover.id::text),21,12))::uuid;
  cap:=GREATEST(12+FLOOR((COALESCE(mover.str,10)-10)/2.0)::int,10);
  SELECT COALESCE(SUM(CASE WHEN i.item_type='consumable' THEN 1.0/3.0 ELSE 1.0 END),0) INTO bag FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id WHERE ci.character_id=mover.id AND ci.equipped_slot IS NULL;
  cost:=5+GREATEST(0,CEIL(bag)::int-cap)*3;
  fighter:=NULL; IF encounter.id IS NOT NULL THEN SELECT * INTO fighter FROM public.node_fighter WHERE encounter_id=encounter.id AND character_id=mover.id AND present FOR UPDATE; END IF;
  INSERT INTO public.combat2_party_departure_member VALUES(_request_id,mover.id,mover.name,ordinal,child,encounter.id,fighter.id,fighter.entry_seq,fighter.arrival_group_id,cost,CASE WHEN fighter.id IS NULL THEN 'waiting' ELSE 'queued' END,NULL,NULL);
  IF fighter.id IS NOT NULL THEN
   queued:=queued+1;
   INSERT INTO public.combat2_departure_request(request_id,character_id,origin_node_id,destination_node_id,direction,encounter_id,fighter_id,fighter_entry_seq,arrival_group_id,cost,status)
    VALUES(child,mover.id,leader.current_node_id,_destination_node_id,conn->>'direction',encounter.id,fighter.id,fighter.entry_seq,fighter.arrival_group_id,cost,'queued');
   INSERT INTO public.node_pending_event(encounter_id,event_type,actor_character_id,payload,request_id,occurred_at)
    VALUES(encounter.id,'fighter_depart_requested',mover.id,jsonb_build_object('departure_request_id',child,'fighter_id',fighter.id,'entry_seq',fighter.entry_seq,'arrival_group_id',fighter.arrival_group_id,
     'origin_node_id',leader.current_node_id,'destination_node_id',_destination_node_id,'cost',cost,'resource_kind','mp'),child,clock_timestamp()+ordinal*interval '1 microsecond') RETURNING id INTO event_id;
   UPDATE public.node_fighter SET exit_request_id=event_id,updated_at=now() WHERE id=fighter.id;
   UPDATE public.node_intent SET status='rejected',reject_reason='exit_pending' WHERE encounter_id=encounter.id AND character_id=mover.id AND status='pending';
  END IF;
 END LOOP;
 IF queued=0 THEN
  FOR mover IN SELECT * FROM public.combat2_party_departure_member WHERE request_id=_request_id ORDER BY movement_order FOR UPDATE LOOP
   PERFORM set_config('app.combat2_depart_authorized','true',true);
   UPDATE public.characters SET current_node_id=_destination_node_id,mp=mp-mover.cost WHERE id=mover.character_id AND current_node_id=leader.current_node_id AND hp>0 AND mp>=mover.cost;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='combat2_party_depart_fence_failed'; END IF;
   UPDATE public.combat2_party_departure_member SET status='moved',resolved_at=now() WHERE request_id=_request_id AND character_id=mover.character_id;
  END LOOP;
  UPDATE public.combat2_party_departure_request SET status='completed',resolved_at=now() WHERE request_id=_request_id;
 ELSE
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL,next_due_at=LEAST(next_due_at,now()),updated_at=now() WHERE id=encounter.id;
 END IF;
 SELECT jsonb_agg(jsonb_build_object('character_id',character_id,'display_name',display_name,'order',movement_order,'status',status,'cost',cost) ORDER BY movement_order) INTO outcomes FROM public.combat2_party_departure_member WHERE request_id=_request_id;
 RETURN jsonb_build_object('ok',true,'kind',CASE WHEN queued=0 THEN 'moved' ELSE 'queued' END,'request_id',_request_id,'origin_node_id',leader.current_node_id,
  'destination_node_id',_destination_node_id,'cost',0,'resource_kind','mp','members',outcomes);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'kind','movement_already_pending');
 WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','party_movement_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role;

-- Refresh/reconnect projection: a participant sees only safe names, ordering and outcomes.
CREATE OR REPLACE FUNCTION public.combat2_party_departure_state(_character_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_build_object('ok',true,'kind','party_departure_state','request_id',r.request_id,
   'status',r.status,'origin_node_id',r.origin_node_id,'destination_node_id',r.destination_node_id,
   'members',(SELECT jsonb_agg(jsonb_build_object('character_id',m.character_id,'display_name',m.display_name,'order',m.movement_order,
     'status',m.status,'cost',m.cost) ORDER BY m.movement_order) FROM public.combat2_party_departure_member m WHERE m.request_id=r.request_id))
  FROM public.combat2_party_departure_request r
  WHERE EXISTS(SELECT 1 FROM public.combat2_party_departure_member own JOIN public.characters c ON c.id=own.character_id
    WHERE own.request_id=r.request_id AND own.character_id=_character_id AND c.user_id=auth.uid())
  ORDER BY r.created_at DESC LIMIT 1),jsonb_build_object('ok',true,'kind','party_departure_state','status','none','members','[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.combat2_party_departure_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_party_departure_state(uuid) TO authenticated,service_role;

-- Following members cannot race the coordinated request with solo movement.
DO $patch$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.combat2_depart(uuid,uuid,uuid)'::regprocedure) INTO d;
 IF position('IF NOT public.owns_character(_character_id)' in d)=0 OR position('-- Lock order:' in d)=0 THEN RAISE EXCEPTION 'unexpected combat2_depart contract'; END IF;
 d:=replace(d,'  -- Lock order:', $body$
  IF EXISTS(SELECT 1 FROM public.party_members pm JOIN public.parties p ON p.id=pm.party_id
    WHERE pm.character_id=_character_id AND pm.status='accepted' AND pm.is_following AND p.leader_id<>_character_id)
   THEN RETURN jsonb_build_object('ok',false,'kind','following_leader'); END IF;

  -- Lock order:$body$);
 EXECUTE d;
END $patch$;

REVOKE ALL ON FUNCTION public.move_follower(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.move_follower(uuid,uuid) TO service_role;
