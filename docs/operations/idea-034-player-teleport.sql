-- Forward candidate only. Lovable's standard Drizzle tool owns the outer transaction/history.
-- Preserve the existing RPC identity, owner, settings and ACL; no legacy/Admin route is enabled.
-- Supabase Auth session contract must be verified by Lovable before installation.
DO $session_guard$ BEGIN
 IF to_regprocedure('auth.jwt()') IS NULL OR to_regclass('auth.sessions') IS NULL
 OR (SELECT count(*) FROM pg_attribute WHERE attrelid='auth.sessions'::regclass AND attname IN('id','user_id') AND atttypid='uuid'::regtype AND NOT attisdropped)<>2
 THEN RAISE EXCEPTION 'waymark Auth session dependency unavailable'; END IF;
 IF NOT has_table_privilege('postgres','auth.sessions','SELECT') OR NOT has_table_privilege('postgres','auth.sessions','UPDATE') THEN
  RAISE EXCEPTION 'waymark owner cannot inspect/lock Auth session membership'; END IF;
END $session_guard$;
ALTER TABLE public.character_waymark ADD COLUMN auth_session_id uuid,
 ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();
-- Existing marks remain unbound/invalid: no retroactive session or inactivity credit.
CREATE FUNCTION public.waymark_live_session() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE sid uuid;
BEGIN
 BEGIN sid:=nullif(auth.jwt()->>'session_id','')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
 IF auth.uid() IS NULL OR sid IS NULL THEN RETURN NULL; END IF;
 -- Key-share serializes a concurrent Auth sign-out deletion; never writes Auth schema/data.
 PERFORM 1 FROM auth.sessions WHERE id=sid AND user_id=auth.uid() FOR KEY SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN sid;
END $$;
CREATE FUNCTION public.character_waymark_state(_character_id uuid,_touch boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
DECLARE sid uuid; mark public.character_waymark;
BEGIN
 sid:=public.waymark_live_session();
 IF sid IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','session_unavailable'); END IF;
 PERFORM 1 FROM public.characters WHERE id=_character_id AND user_id=auth.uid() AND deleted_at IS NULL AND hp>0 FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT * INTO mark FROM public.character_waymark WHERE character_id=_character_id FOR UPDATE;
 IF NOT FOUND OR mark.auth_session_id IS DISTINCT FROM sid OR mark.last_activity_at<=clock_timestamp()-interval '20 minutes'
 THEN RETURN jsonb_build_object('ok',true,'character_id',_character_id,'node_id',NULL); END IF;
 IF _touch THEN
  UPDATE public.character_waymark SET last_activity_at=clock_timestamp() WHERE character_id=_character_id RETURNING * INTO mark;
 END IF;
 RETURN jsonb_build_object('ok',true,'character_id',_character_id,'node_id',mark.node_id,'expires_at',mark.last_activity_at+interval '20 minutes');
END $$;
ALTER FUNCTION public.waymark_live_session() OWNER TO postgres;
ALTER FUNCTION public.character_waymark_state(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.waymark_live_session(),public.character_waymark_state(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.character_waymark_state(uuid,boolean) TO authenticated;
DO $waymark_acl$ DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.waymark_live_session(),public.character_waymark_state(uuid,boolean) FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IN('public.waymark_live_session()'::regprocedure,'public.character_waymark_state(uuid,boolean)'::regprocedure)
 AND (a.grantee<>p.proowner AND NOT(p.oid='public.character_waymark_state(uuid,boolean)'::regprocedure AND a.grantee='authenticated'::regrole AND NOT a.is_grantable)))
 THEN RAISE EXCEPTION 'unexpected waymark function authority'; END IF;
END $waymark_acl$;
DO $travel$
DECLARE target regprocedure:=to_regprocedure('public.character_special_travel(uuid,text,uuid,uuid)');
 before record; after record; definition text; original text; body text; expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
 ('public.creature_hp_cover(uuid[],uuid[])','3722c9e2caec90d600f244b017b80331'),
 ('public.creature_hp_account(jsonb)','62fa096206e88bee64a59acad604b389'),
 ('public.combat2_arrive_after_relocation(uuid,uuid)','1bdd13b0cd0c53cb1f594e73e393030b')
 ) p(signature,body_md5) LOOP
  SELECT md5(regexp_replace(prosrc,'[[:space:]]+',' ','g')) body_md5,prosecdef,pg_get_userbyid(proowner) owner
  INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF NOT FOUND OR actual.body_md5 IS DISTINCT FROM expected.body_md5 OR actual.prosecdef IS DISTINCT FROM true
   OR actual.owner IS DISTINCT FROM 'postgres' THEN RAISE EXCEPTION 'player travel dependency drift: %',expected.signature; END IF;
 END LOOP;
 IF target IS NULL THEN RAISE EXCEPTION 'missing character_special_travel'; END IF;
 SELECT proowner,prosecdef,proconfig,proacl INTO before FROM pg_proc WHERE oid=target;
 SELECT prosrc,pg_get_functiondef(target) INTO original,definition FROM pg_proc WHERE oid=target;
 IF md5(regexp_replace(original,'[[:space:]]+',' ','g')) IS DISTINCT FROM 'e4055318d1c76bc9b0383eba7ecbf757'
 OR pg_get_userbyid(before.proowner) IS DISTINCT FROM 'postgres' OR before.prosecdef IS DISTINCT FROM true
 OR before.proconfig IS DISTINCT FROM ARRAY['search_path=public, auth, pg_temp'] THEN RAISE EXCEPTION 'player travel source/settings drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass AND tgname='combat2_authoritative_arrival'
 AND tgfoid='public.combat2_authoritative_arrival_trigger()'::regprocedure AND tgenabled='O' AND tgtype=17 AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'canonical arrival trigger unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.character_visited_nodes'::regclass AND tgname='character_lifecycle_child_fence'
 AND tgfoid='public.character_lifecycle_child_fence()'::regprocedure AND tgenabled='O' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'visited-node lifecycle fence unavailable'; END IF;
 body:=replace(original,' SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;',$coverage$
 SELECT current_node_id INTO hp_origin FROM public.characters WHERE id=_character_id AND user_id=auth.uid() AND deleted_at IS NULL;
 IF hp_origin IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RETURN jsonb_build_object('ok',false,'kind','isolation_unsupported'); END IF;
 hp_scope:=public.creature_hp_cover(ARRAY[hp_origin,_destination_node_id],ARRAY[_character_id]);
 PERFORM set_config('app.creature_hp_coverage',hp_scope::text,true);
 FOR hp_legacy IN SELECT id FROM public.encounters WHERE node_id IN(hp_origin,_destination_node_id) ORDER BY id LOOP
  IF NOT pg_try_advisory_xact_lock(public.encounter_lock_key(hp_legacy.id)) THEN
   RETURN jsonb_build_object('ok',false,'kind','transition_conflict');
  END IF;
 END LOOP;
 PERFORM 1 FROM public.characters lock_c WHERE lock_c.id=_character_id OR (
 lock_c.current_node_id=_destination_node_id AND EXISTS(SELECT 1 FROM public.party_members mine
 JOIN public.party_members peer ON peer.party_id=mine.party_id WHERE mine.character_id=_character_id AND mine.status='accepted'
 AND peer.status='accepted' AND peer.character_id=lock_c.id)) ORDER BY lock_c.id FOR UPDATE;
 SELECT * INTO c FROM public.characters WHERE id=_character_id FOR UPDATE;
 IF c.id IS NULL OR c.user_id IS DISTINCT FROM auth.uid() OR c.deleted_at IS NOT NULL
 OR c.current_node_id IS DISTINCT FROM hp_origin THEN RETURN jsonb_build_object('ok',false,'kind','state_changed'); END IF;
 IF (_kind='teleport' AND c.level<22 AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_teleport))
 OR (_kind='waymark' AND c.level<22) THEN RETURN jsonb_build_object('ok',false,'kind','personal_teleport_locked'); END IF;
 IF c.movement_locked_until>clock_timestamp()
 OR EXISTS(SELECT 1 FROM public.combat2_party_departure_member WHERE character_id=c.id AND status='waiting')
 OR EXISTS(SELECT 1 FROM public.node_encounter WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(hp_scope->'encounters') v) AND claim_token IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.node_fighter WHERE character_id=c.id AND present)
 OR EXISTS(SELECT 1 FROM public.node_intent WHERE status='pending' AND (character_id=c.id OR target_character_id=c.id))
 OR EXISTS(SELECT 1 FROM public.node_pending_event WHERE actor_character_id=c.id AND consumed_at IS NULL)
 OR EXISTS(SELECT 1 FROM public.node_effect WHERE target_character_id=c.id)
 OR EXISTS(SELECT 1 FROM public.encounter_participants WHERE character_id=c.id)
 OR EXISTS(SELECT 1 FROM public.combat_actions WHERE character_id=c.id AND status='pending')
 THEN RETURN jsonb_build_object('ok',false,'kind','transition_conflict'); END IF;
 IF EXISTS(SELECT 1 FROM public.party_members mine JOIN public.party_members other ON other.party_id=mine.party_id
 WHERE mine.character_id=c.id AND mine.status='accepted' AND other.status='accepted' AND other.is_following AND other.character_id<>c.id)
 THEN RETURN jsonb_build_object('ok',false,'kind','party_following'); END IF;
$coverage$);
 IF body=original THEN RAISE EXCEPTION 'player travel lock insertion drift'; END IF;
 -- Receipt replay remains first. New personal/waymark travel needs a live Auth session.
 body:=replace(body,' SELECT current_node_id INTO hp_origin',
  ' hp_session:=public.waymark_live_session(); SELECT current_node_id INTO hp_origin');
 body:=replace(body,' IF _kind=''teleport'' THEN', $waymark$
 IF (_kind='waymark' OR (c.level>=22 AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_teleport))) AND hp_session IS NULL
 THEN RETURN jsonb_build_object('ok',false,'kind','session_unavailable'); END IF;
 IF _kind='teleport' THEN$waymark$);
 body:=replace(body,'SELECT node_id INTO destination FROM public.character_waymark WHERE character_id=c.id;',
  'SELECT node_id INTO destination FROM public.character_waymark WHERE character_id=c.id AND auth_session_id=hp_session AND last_activity_at>clock_timestamp()-interval ''20 minutes'';');
 body:=replace(body,'INSERT INTO public.character_waymark(character_id,node_id) VALUES(c.id,c.current_node_id)',
  'INSERT INTO public.character_waymark(character_id,node_id,auth_session_id,last_activity_at) VALUES(c.id,c.current_node_id,hp_session,clock_timestamp())');
 body:=replace(body,'DO UPDATE SET node_id=excluded.node_id,set_at=now();',
  'DO UPDATE SET node_id=excluded.node_id,set_at=now(),auth_session_id=excluded.auth_session_id,last_activity_at=excluded.last_activity_at;');
 -- Returning never consumes/replaces the mark. Successful travel is activity, after expiry validation.
 body:=replace(body,' INSERT INTO public.character_special_travel_request VALUES(',
  ' UPDATE public.character_waymark SET last_activity_at=clock_timestamp() WHERE character_id=c.id AND auth_session_id=hp_session AND last_activity_at>clock_timestamp()-interval ''20 minutes''; INSERT INTO public.character_special_travel_request VALUES(');
 -- The existing party buttons already send a frozen destination-node UUID. Authorize that node
 -- only while another accepted, living, stationary member is there, under the covered row locks.
 body:=replace(body,'v.character_id=c.id AND v.node_id=n.id)))',$party$
v.character_id=c.id AND v.node_id=n.id))) AND NOT (c.level>=22 AND EXISTS(
 SELECT 1 FROM public.party_members mine JOIN public.party_members peer ON peer.party_id=mine.party_id
 JOIN public.characters target ON target.id=peer.character_id
 WHERE mine.character_id=c.id AND mine.status='accepted' AND peer.status='accepted' AND target.id<>c.id
 AND target.current_node_id=destination AND target.deleted_at IS NULL AND target.hp>0
 AND (target.movement_locked_until IS NULL OR target.movement_locked_until<=clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM public.node_fighter f JOIN public.node_encounter e ON e.id=f.encounter_id WHERE f.character_id=target.id AND f.present AND e.status='active')
 AND NOT EXISTS(SELECT 1 FROM public.combat_sessions s WHERE s.character_id=target.id)
 AND NOT EXISTS(SELECT 1 FROM public.combat2_departure_request d WHERE d.character_id=target.id AND d.status='queued')
 AND NOT EXISTS(SELECT 1 FROM public.combat2_party_departure_member m WHERE m.character_id=target.id AND m.status IN('queued','waiting'))))
$party$);
 body:=replace(body,' PERFORM set_config(''app.combat2_depart_authorized'',''true'',true);',
  ' INSERT INTO public.character_visited_nodes(character_id,node_id) VALUES(c.id,c.current_node_id) ON CONFLICT(character_id,node_id) DO NOTHING; PERFORM public.creature_hp_account(hp_scope); PERFORM set_config(''app.combat2_depart_authorized'',''true'',true);');
 body:=replace(body,' INSERT INTO public.character_special_travel_request VALUES(',
  ' PERFORM public.creature_hp_account(hp_scope); INSERT INTO public.character_special_travel_request VALUES(');
 body:=replace(body,' IF _kind NOT IN(''teleport'',''waymark'') OR _request_id IS NULL',
  ' IF _kind IS NULL OR _kind NOT IN(''teleport'',''waymark'') OR _request_id IS NULL OR _destination_node_id IS NULL');
 body:=replace(body,'EXCEPTION WHEN OTHERS THEN',
  'EXCEPTION WHEN serialization_failure OR lock_not_available THEN RETURN jsonb_build_object(''ok'',false,''kind'',''transition_conflict''); WHEN OTHERS THEN');
 -- Every original/inserted return is a single jsonb_build_object expression; reject an unhandled shape.
 body:=regexp_replace(body,'RETURN (jsonb_build_object\([^;]+\));','hp_result := \1; EXIT hp_travel;','g');
 IF position('RETURN ' IN body)>0 THEN RAISE EXCEPTION 'unhandled player travel return'; END IF;
 body:=$wrapper$
DECLARE hp_scope jsonb; hp_origin uuid; hp_legacy record; hp_result jsonb; hp_session uuid;
 hp_inherited text:=current_setting('app.creature_hp_coverage',true);
 hp_authorized text:=current_setting('app.combat2_depart_authorized',true);
BEGIN
 BEGIN
 <<hp_travel>>
$wrapper$||body||';'||$wrapper$
 IF hp_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'player travel refusal' USING ERRCODE='P1034'; END IF;
 EXCEPTION WHEN SQLSTATE 'P1034' THEN NULL;
 END;
 PERFORM set_config('app.creature_hp_coverage',coalesce(hp_inherited,''),true);
 PERFORM set_config('app.combat2_depart_authorized',coalesce(hp_authorized,''),true);
 hp_result:=hp_result||jsonb_build_object('request_id',_request_id,'account_id',auth.uid(),'character_id',_character_id,'travel_kind',_kind,
  'destination_node_id',_destination_node_id,'outcome',CASE WHEN hp_result->>'ok'='true' THEN 'committed' ELSE 'not_committed' END);
 IF hp_result->>'ok'='true' THEN
  hp_result:=hp_result||jsonb_build_object('origin_node_id',(SELECT origin_node_id FROM public.character_special_travel_request WHERE request_id=_request_id),
   'waymark_node_id',NULL);
 END IF;
 RETURN hp_result;
END;
$wrapper$;
 EXECUTE replace(definition,original,body);
 SELECT proowner,prosecdef,proconfig,proacl INTO after FROM pg_proc WHERE oid=target;
 IF before IS DISTINCT FROM after THEN RAISE EXCEPTION 'player travel metadata changed'; END IF;
 IF has_function_privilege('anon',target,'EXECUTE') OR NOT has_function_privilege('authenticated',target,'EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=target AND a.grantee=0)
 THEN RAISE EXCEPTION 'unexpected player travel authority'; END IF;
END $travel$;

-- Discovery is now used for authorization, not just map shading. Keep the existing table/RLS;
-- browser upserts may record only the character's actual current location.
CREATE FUNCTION public.guard_visited_node_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.character_id,NEW.node_id) IS DISTINCT FROM ROW(OLD.character_id,OLD.node_id) THEN
  RAISE EXCEPTION 'discovery_identity_immutable' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.characters c
 WHERE c.id=NEW.character_id AND c.current_node_id=NEW.node_id AND c.deleted_at IS NULL AND c.hp>0) THEN
  RAISE EXCEPTION 'discovery_requires_presence' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.record_character_node_visit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.current_node_id IS NOT DISTINCT FROM OLD.current_node_id THEN RETURN NEW; END IF;
 IF NEW.current_node_id IS NOT NULL AND NEW.deleted_at IS NULL AND NEW.hp>0 THEN
  INSERT INTO public.character_visited_nodes(character_id,node_id) VALUES(NEW.id,NEW.current_node_id) ON CONFLICT(character_id,node_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION public.guard_visited_node_location() OWNER TO postgres;
ALTER FUNCTION public.record_character_node_visit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_visited_node_location(),public.record_character_node_visit() FROM PUBLIC,anon,authenticated,service_role;
DO $acl$ DECLARE role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['sandbox_exec','sandbox_exec_gpclaklkaolyzfnooajt'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION public.guard_visited_node_location(),public.record_character_node_visit() FROM %I',role_name);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IN('public.guard_visited_node_location()'::regprocedure,'public.record_character_node_visit()'::regprocedure)
 AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'unexpected visit trigger function grant'; END IF;
END $acl$;
CREATE TRIGGER guard_visited_node_location BEFORE INSERT OR UPDATE ON public.character_visited_nodes
 FOR EACH ROW EXECUTE FUNCTION public.guard_visited_node_location();
CREATE TRIGGER record_character_node_visit AFTER INSERT OR UPDATE OF current_node_id ON public.characters
 FOR EACH ROW EXECUTE FUNCTION public.record_character_node_visit();
