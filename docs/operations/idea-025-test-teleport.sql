-- LOCAL forward candidate. Standard Lovable Drizzle lane owns the transaction.
-- Empty by default. Enrollment requires separately approved exact UUID triples.
DO $dependencies$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('public.creature_hp_discover(uuid[],uuid[])','b2e1ea0696f2eacd31af3eaa42418ac2','search_path=pg_catalog, public, pg_temp'),
 ('public.creature_hp_cover(uuid[],uuid[])','3722c9e2caec90d600f244b017b80331','search_path=pg_catalog, public, pg_temp'),
 ('public.creature_hp_account(jsonb)','62fa096206e88bee64a59acad604b389','search_path=pg_catalog, public, pg_temp'),
 ('public.combat2_arrive_after_relocation(uuid,uuid)','1bdd13b0cd0c53cb1f594e73e393030b','search_path=public, pg_temp'),
 ('public.combat2_seed_spawns(uuid,uuid)','b41cbd51b486b16302c71415eb78c817','search_path=public, pg_temp'),
 ('public.combat2_refresh_tanks(uuid)','adea12570a3943cfb164cd75b72eee5e','search_path=public, pg_temp'),
 ('public.character_lifecycle_child_fence()','180a552a41379fe98e9c9155d021be4e','search_path=pg_catalog, public, pg_temp')
 ) v(signature,body_md5,settings) LOOP
   SELECT pg_get_userbyid(proowner) owner,prosecdef,proconfig,md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) body_md5
     INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
   IF NOT FOUND OR actual.owner IS DISTINCT FROM 'postgres' OR actual.prosecdef IS DISTINCT FROM true
     OR actual.proconfig IS DISTINCT FROM ARRAY[expected.settings] OR actual.body_md5 IS DISTINCT FROM expected.body_md5 THEN
     RAISE EXCEPTION 'test travel dependency drift: %',expected.signature;
   END IF;
 END LOOP;
END $dependencies$;
CREATE TABLE public.gameplay_test_destination (
 account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
 node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
 PRIMARY KEY(account_id,character_id,node_id)
);
CREATE TABLE public.gameplay_test_teleport_receipt (
 request_id uuid PRIMARY KEY, account_id uuid NOT NULL,
 character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
 destination_node_id uuid NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gameplay_test_destination OWNER TO postgres;
ALTER TABLE public.gameplay_test_teleport_receipt OWNER TO postgres;
ALTER TABLE public.gameplay_test_destination ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gameplay_test_teleport_receipt ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.gameplay_test_destination
 FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id');
CREATE TRIGGER character_lifecycle_child_fence BEFORE INSERT OR UPDATE OR DELETE ON public.gameplay_test_teleport_receipt
 FOR EACH ROW EXECUTE FUNCTION public.character_lifecycle_child_fence('character_id');

CREATE FUNCTION public.gameplay_test_teleport_access_internal(_actor uuid,_character uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT CASE WHEN auth.role() IS DISTINCT FROM 'service_role' THEN '[]'::jsonb ELSE
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'region_id',n.region_id) ORDER BY n.id)
 FROM public.gameplay_test_destination a JOIN public.characters c ON c.id=a.character_id
 JOIN public.nodes n ON n.id=a.node_id
 WHERE a.account_id=_actor AND a.character_id=_character AND c.user_id=_actor AND c.deleted_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_node t WHERE t.node_id=n.id)), '[]'::jsonb) END
$$;

CREATE FUNCTION public.gameplay_test_teleport_internal(_actor uuid,_character uuid,_destination uuid,_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.characters; origin uuid; coverage jsonb; previous public.gameplay_test_teleport_receipt;
 result jsonb; legacy record;
 inherited text:=current_setting('app.creature_hp_coverage',true);
 authorized text:=current_setting('app.combat2_depart_authorized',true);
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' OR _actor IS NULL OR _character IS NULL
 OR _destination IS NULL OR _request IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
   RAISE EXCEPTION 'test travel requires read committed' USING ERRCODE='25000';
 END IF;
 -- This unique request lock precedes node locks. No cooperating path acquires it later.
 PERFORM pg_advisory_xact_lock(hashtextextended('gameplay-test-teleport:'||_request::text,0));
 SELECT * INTO previous FROM public.gameplay_test_teleport_receipt WHERE request_id=_request;
 IF FOUND THEN
   IF previous.account_id IS DISTINCT FROM _actor OR previous.character_id IS DISTINCT FROM _character
   OR previous.destination_node_id IS DISTINCT FROM _destination THEN
     RAISE EXCEPTION 'request_id_conflict' USING ERRCODE='22023';
   END IF;
   RETURN previous.result; -- Historical result only: never teleport again on replay.
 END IF;
 SELECT current_node_id INTO origin FROM public.characters WHERE id=_character AND user_id=_actor AND deleted_at IS NULL;
 IF origin IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gameplay_test_destination WHERE account_id=_actor AND character_id=_character AND node_id=_destination) THEN
   RAISE EXCEPTION 'destination_not_approved' USING ERRCODE='42501';
 END IF;
 -- Installed 0024 helper: discover closure; sorted node gates -> party lifecycle -> encounter/HP rows,
 -- with coverage revalidation. This is also the arrival trigger's inherited scope.
 coverage:=public.creature_hp_cover(ARRAY[origin,_destination],ARRAY[_character]);
 PERFORM set_config('app.creature_hp_coverage',coverage::text,true);
 -- The retained Combat1 node-change cleanup acquires this lock. Take it before the character,
 -- and refuse retained active/participating legacy state below. No Combat1 behavior is repaired.
 FOR legacy IN SELECT id FROM public.encounters WHERE node_id=ANY(ARRAY[origin,_destination]) ORDER BY id LOOP
   IF NOT pg_try_advisory_xact_lock(public.encounter_lock_key(legacy.id)) THEN
     RAISE EXCEPTION 'legacy_encounter_busy' USING ERRCODE='40001';
   END IF;
 END LOOP;
 SELECT * INTO c FROM public.characters WHERE id=_character FOR NO KEY UPDATE;
 IF c.user_id IS DISTINCT FROM _actor OR c.deleted_at IS NOT NULL OR c.hp<=0
 OR c.current_node_id IS DISTINCT FROM origin THEN RAISE EXCEPTION 'character_state_changed' USING ERRCODE='40001'; END IF;
 -- Hold the approval through commit; concurrent revocation cannot overtake an accepted request.
 PERFORM 1 FROM public.gameplay_test_destination WHERE account_id=_actor AND character_id=c.id AND node_id=_destination FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.combat2_test_arena_node WHERE node_id=ANY(ARRAY[origin,_destination])) THEN
   RAISE EXCEPTION 'destination_not_approved' USING ERRCODE='42501';
 END IF;
 -- Initial scope is strictly solo, including pending invitees/leaders. No silent party detach.
 IF EXISTS(SELECT 1 FROM public.party_members WHERE character_id=c.id)
 OR EXISTS(SELECT 1 FROM public.parties WHERE leader_id=c.id OR tank_id=c.id) THEN
   RAISE EXCEPTION 'party_state_unsafe' USING ERRCODE='P0001';
 END IF;
 IF c.movement_locked_until>clock_timestamp()
 OR EXISTS(SELECT 1 FROM public.combat2_departure_request WHERE character_id=c.id AND status='queued')
 OR EXISTS(SELECT 1 FROM public.combat2_party_departure_member WHERE character_id=c.id AND status IN('queued','waiting')) THEN
   RAISE EXCEPTION 'movement_pending' USING ERRCODE='P0001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.id IN(
   SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'encounters') v)
   AND (e.status='active' OR e.claim_token IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.node_intent i WHERE i.encounter_id=e.id AND i.status='pending')
    OR EXISTS(SELECT 1 FROM public.node_pending_event p WHERE p.encounter_id=e.id AND p.consumed_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.node_effect x WHERE x.encounter_id=e.id)
    OR EXISTS(SELECT 1 FROM public.node_creature x WHERE x.encounter_id=e.id AND x.pending_action IS NOT NULL)))
 OR EXISTS(SELECT 1 FROM public.node_fighter WHERE character_id=c.id AND present)
 OR EXISTS(SELECT 1 FROM public.encounters WHERE node_id=ANY(ARRAY[origin,_destination]) AND status='active')
 OR EXISTS(SELECT 1 FROM public.encounter_participants WHERE character_id=c.id)
 OR EXISTS(SELECT 1 FROM public.combat_sessions WHERE character_id=c.id OR node_id=ANY(ARRAY[origin,_destination]))
 OR EXISTS(SELECT 1 FROM public.combat_actions WHERE character_id=c.id AND status='pending')
 OR EXISTS(SELECT 1 FROM public.active_effects WHERE target_id=c.id AND expires_at>extract(epoch FROM clock_timestamp())*1000) THEN
   RAISE EXCEPTION 'encounter_unresolved' USING ERRCODE='P0001';
 END IF;
 PERFORM public.creature_hp_account(coverage);
 PERFORM set_config('app.combat2_depart_authorized','true',true);
 -- Existing AFTER trigger performs canonical 0024-aware arrival (including hostile entry),
 -- and retained participation cleanup. Never disable triggers or invoke the retired helper.
 UPDATE public.characters SET current_node_id=_destination WHERE id=c.id;
 PERFORM public.creature_hp_account(coverage);
 result:=jsonb_build_object('ok',true,'outcome','committed','request_id',_request,
   'character_id',c.id,'destination_node_id',_destination,'origin_node_id',origin);
 INSERT INTO public.gameplay_test_teleport_receipt(request_id,account_id,character_id,destination_node_id,result)
 VALUES(_request,_actor,c.id,_destination,result);
 PERFORM set_config('app.combat2_depart_authorized',coalesce(authorized,''),true);
 PERFORM set_config('app.creature_hp_coverage',coalesce(inherited,''),true);
 RETURN result;
 -- No caught exceptions: any refusal/arrival/receipt failure aborts the entire RPC transaction.
END $$;

ALTER FUNCTION public.gameplay_test_teleport_access_internal(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON public.gameplay_test_destination,public.gameplay_test_teleport_receipt FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.gameplay_test_teleport_access_internal(uuid,uuid),public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.gameplay_test_teleport_access_internal(uuid,uuid),public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid) TO service_role;
-- Explicit object-only platform-default containment; no global defaults or blanket exception.
DO $acl$
DECLARE r text; t text; f text;
BEGIN
 FOREACH r IN ARRAY ARRAY['sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.gameplay_test_destination,public.gameplay_test_teleport_receipt FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION public.gameplay_test_teleport_access_internal(uuid,uuid),public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid) FROM %I',r);
  END IF;
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role','sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOREACH t IN ARRAY ARRAY['public.gameplay_test_destination','public.gameplay_test_teleport_receipt'] LOOP
    IF has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'test teleport table authority drift: %',r;
    END IF;
   END LOOP;
   IF r<>'service_role' THEN
    FOREACH f IN ARRAY ARRAY['public.gameplay_test_teleport_access_internal(uuid,uuid)','public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid)'] LOOP
     IF has_function_privilege(r,f,'EXECUTE') THEN RAISE EXCEPTION 'test teleport RPC authority drift: %',r; END IF;
    END LOOP;
   END IF;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE c.oid IN('public.gameplay_test_destination'::regclass,'public.gameplay_test_teleport_receipt'::regclass)
   AND a.grantee<>c.relowner) THEN RAISE EXCEPTION 'unexpected private test travel table grant'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid IN('public.gameplay_test_teleport_access_internal(uuid,uuid)'::regprocedure,'public.gameplay_test_teleport_internal(uuid,uuid,uuid,uuid)'::regprocedure)
   AND a.grantee NOT IN(p.proowner,'service_role'::regrole::oid)) THEN RAISE EXCEPTION 'unexpected test travel function grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass AND tgname='combat2_authoritative_arrival' AND tgenabled='O' AND tgtype=17
    AND tgfoid='public.combat2_authoritative_arrival_trigger()'::regprocedure AND NOT tgisinternal)
 OR to_regprocedure('public.creature_hp_cover(uuid[],uuid[])') IS NULL THEN RAISE EXCEPTION 'canonical arrival dependencies unavailable'; END IF;
END $acl$;
