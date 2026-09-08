-- Close node_encounter_visibility_via_client_writable_current_node_id.
-- Browser roles retain reads and an explicit preference-only column allowlist.
REVOKE INSERT,UPDATE,DELETE ON TABLE public.characters FROM PUBLIC,anon,authenticated;
REVOKE UPDATE(current_node_id,mp,hp,cp,gold,xp,level,max_hp,max_mp,max_cp,ac,str,dex,con,int,wis,cha,
  stance_state,reserved_buffs,movement_locked_until,last_death_at,last_death_log,user_id)
  ON public.characters FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.characters TO authenticated;
GRANT UPDATE(last_online,wimp_hp_threshold,wimp_direction,portrait_url,portrait_metadata,portrait_generated_at)
  ON public.characters TO authenticated;

DROP POLICY IF EXISTS "Users can update own characters" ON public.characters;
DROP POLICY IF EXISTS "Users can create characters" ON public.characters;
DROP POLICY IF EXISTS "Users can delete own characters" ON public.characters;
CREATE POLICY "Users can update safe own character fields" ON public.characters FOR UPDATE TO authenticated
 USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);

-- Creation keeps its existing shape but derives identity and starting location.
CREATE OR REPLACE FUNCTION public.character_create(
 _name text,_race text,_class text,_gender text,_str integer,_dex integer,_con integer,
 _int integer,_wis integer,_cha integer,_hp integer,_max_hp integer,_ac integer,_is_classless boolean DEFAULT false
) RETURNS public.characters
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); start_node uuid; created public.characters;
BEGIN
 IF caller IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_authorized'; END IF;
 SELECT default_node_id INTO start_node FROM public.combat2_respawn_config WHERE singleton;
 IF start_node IS NULL OR EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=start_node)
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='starting_location_unavailable'; END IF;
 IF NULLIF(btrim(_name),'') IS NULL OR length(btrim(_name))>40
   OR LEAST(_str,_dex,_con,_int,_wis,_cha,_hp,_max_hp,_ac)<0 OR _hp<>_max_hp
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_character'; END IF;
 INSERT INTO public.characters(user_id,name,race,class,gender,str,dex,con,int,wis,cha,hp,max_hp,ac,current_node_id,is_classless)
 VALUES(caller,btrim(_name),_race::public.character_race,_class::public.character_class,_gender::public.character_gender,
  _str,_dex,_con,_int,_wis,_cha,_hp,_max_hp,_ac,start_node,COALESCE(_is_classless,false)) RETURNING * INTO created;
 RETURN created;
END $$;
REVOKE ALL ON FUNCTION public.character_create(text,text,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.character_create(text,text,text,text,integer,integer,integer,integer,integer,integer,integer,integer,integer,boolean) TO authenticated,service_role;

CREATE TABLE public.character_special_travel_request(
 request_id uuid PRIMARY KEY,character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN('teleport','waymark')),origin_node_id uuid NOT NULL REFERENCES public.nodes(id),
 destination_node_id uuid NOT NULL REFERENCES public.nodes(id),cp_cost integer NOT NULL CHECK(cp_cost>=0),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.character_waymark(
 character_id uuid PRIMARY KEY REFERENCES public.characters(id) ON DELETE CASCADE,node_id uuid NOT NULL REFERENCES public.nodes(id),set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.character_special_travel_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_waymark ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.character_special_travel_request,public.character_waymark FROM PUBLIC,anon,authenticated;
GRANT ALL PRIVILEGES ON public.character_special_travel_request,public.character_waymark TO service_role;

CREATE OR REPLACE FUNCTION public.character_special_travel(_character_id uuid,_kind text,_destination_node_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE c public.characters; prior public.character_special_travel_request; destination uuid; origin_region public.regions; target_region public.regions; cost integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF _kind NOT IN('teleport','waymark') OR _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('character_special_travel:'||_request_id::text,0));
 SELECT * INTO prior FROM public.character_special_travel_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.character_id<>_character_id OR prior.kind<>_kind OR prior.destination_node_id IS DISTINCT FROM _destination_node_id
   THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'kind','already_moved','destination_node_id',prior.destination_node_id,'cp_cost',prior.cp_cost);
 END IF;
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF c.hp<=0 OR c.current_node_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','state_changed'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id WHERE f.character_id=c.id AND f.present AND e.status='active')
   OR EXISTS(SELECT 1 FROM public.combat_sessions s WHERE s.character_id=c.id OR s.party_id IN(SELECT party_id FROM public.party_members WHERE character_id=c.id AND status='accepted'))
  THEN RETURN jsonb_build_object('ok',false,'kind','combat_active'); END IF;
 IF EXISTS(SELECT 1 FROM public.party_members pm JOIN public.parties p ON p.id=pm.party_id WHERE pm.character_id=c.id AND pm.status='accepted' AND pm.is_following AND p.leader_id<>c.id)
  THEN RETURN jsonb_build_object('ok',false,'kind','following_leader'); END IF;
 IF _kind='teleport' THEN
  destination:=_destination_node_id;
  IF NOT EXISTS(SELECT 1 FROM public.nodes n WHERE n.id=destination AND n.is_teleport AND (n.is_public_teleport OR EXISTS(
    SELECT 1 FROM public.character_visited_nodes v WHERE v.character_id=c.id AND v.node_id=n.id)))
   THEN RETURN jsonb_build_object('ok',false,'kind','invalid_destination'); END IF;
 ELSE
  SELECT node_id INTO destination FROM public.character_waymark WHERE character_id=c.id;
  IF destination IS NULL OR destination IS DISTINCT FROM _destination_node_id THEN RETURN jsonb_build_object('ok',false,'kind','waymark_unavailable'); END IF;
 END IF;
 SELECT r.* INTO origin_region FROM public.nodes n JOIN public.regions r ON r.id=n.region_id WHERE n.id=c.current_node_id;
 SELECT r.* INTO target_region FROM public.nodes n JOIN public.regions r ON r.id=n.region_id WHERE n.id=destination;
 cost:=CASE WHEN origin_region.id IS NULL THEN 15 WHEN origin_region.id=target_region.id THEN 10 ELSE LEAST(10+abs(origin_region.min_level-target_region.min_level)*2,30) END;
 IF c.cp<cost THEN RETURN jsonb_build_object('ok',false,'kind','insufficient_cp'); END IF;
 IF _kind='teleport' AND c.level>=22 AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_teleport) THEN
  INSERT INTO public.character_waymark(character_id,node_id) VALUES(c.id,c.current_node_id)
   ON CONFLICT(character_id) DO UPDATE SET node_id=excluded.node_id,set_at=now();
 END IF;
 PERFORM set_config('app.combat2_depart_authorized','true',true);
 UPDATE public.characters SET current_node_id=destination,cp=cp-cost WHERE id=c.id AND current_node_id=c.current_node_id AND cp>=cost;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','state_changed'); END IF;
 INSERT INTO public.character_special_travel_request VALUES(_request_id,c.id,_kind,c.current_node_id,destination,cost,now());
 RETURN jsonb_build_object('ok',true,'kind','moved','destination_node_id',destination,'cp_cost',cost);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','travel_failed');
END $$;
REVOKE ALL ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.character_special_travel(uuid,text,uuid,uuid) TO authenticated,service_role;

-- A caller may choose the target, but never the authoritative summon origin.
CREATE OR REPLACE FUNCTION public.guard_summon_request_origin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.owns_character(NEW.summoner_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_authorized'; END IF;
 SELECT current_node_id INTO NEW.summoner_node_id FROM public.characters WHERE id=NEW.summoner_id AND hp>0;
 IF NEW.summoner_node_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='summoner_unavailable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_summon_request_origin() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_summon_request_origin ON public.summon_requests;
CREATE TRIGGER guard_summon_request_origin BEFORE INSERT ON public.summon_requests FOR EACH ROW EXECUTE FUNCTION public.guard_summon_request_origin();

DO $patch$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.accept_summon(uuid)'::regprocedure) INTO d;
 IF position('IF NOT owns_character(_req.target_id)' in d)=0 THEN RAISE EXCEPTION 'unexpected accept_summon contract'; END IF;
 d:=replace(d,'  IF NOT owns_character(_req.target_id) THEN',$body$
  IF NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_req.summoner_id AND c.hp>0 AND c.current_node_id=_req.summoner_node_id) THEN
    RAISE EXCEPTION 'Summon origin changed';
  END IF;

  IF NOT owns_character(_req.target_id) THEN$body$);
 EXECUTE d;
END $patch$;

-- Same-node visibility remains, but dead rows cannot act as visibility anchors.
CREATE OR REPLACE FUNCTION public.encounter_visible_to_caller(_encounter_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.node_encounter e JOIN public.characters c ON c.current_node_id=e.node_id
  WHERE e.id=_encounter_id AND c.user_id=auth.uid() AND c.hp>0);
$$;
REVOKE ALL ON FUNCTION public.encounter_visible_to_caller(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.encounter_visible_to_caller(uuid) TO authenticated,service_role;
DROP POLICY IF EXISTS "read encounter at own node" ON public.node_encounter;
CREATE POLICY "read encounter at own live node" ON public.node_encounter FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.characters c WHERE c.user_id=auth.uid() AND c.hp>0 AND c.current_node_id=node_encounter.node_id));

-- Make effective ACLs explicit for every retained location authority.
REVOKE ALL ON FUNCTION public.move_follower(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.move_follower(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.admin_teleport(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.accept_summon(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_summon(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_depart(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_depart(uuid,uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.combat2_respawn(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_respawn(uuid,uuid) TO authenticated,service_role;
