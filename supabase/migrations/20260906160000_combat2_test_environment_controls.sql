-- Authoritative, admin-only Combat2 test-environment lifecycle controls.
ALTER TABLE public.combat2_test_arena_request DROP CONSTRAINT combat2_test_arena_request_operation_check;
ALTER TABLE public.combat2_test_arena_request ADD CONSTRAINT combat2_test_arena_request_operation_check
 CHECK(operation IN('stop','reset','environment_start','environment_close'));

CREATE OR REPLACE FUNCTION public.combat2_test_status(_arena_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE out jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT jsonb_build_object(
  'ok',true,'kind','status','arena_id',a.id,'arena_key',a.arena_key,'label',a.label,'active',a.active,
  'stopped',NOT EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.status='active'),
  'reset_eligible',a.active AND NOT EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=a.id AND (e.status='active' OR e.claim_token IS NOT NULL)),
  'combat_mode',COALESCE((SELECT value FROM public.combat_config WHERE key='combat_mode'),'maintenance'),
  'world_state',COALESCE((SELECT state FROM public.world_state WHERE id=1),'asleep'),
  'scheduler_enabled',(SELECT count(*)=1 AND count(*) FILTER(WHERE schedule='2 seconds' AND command='SELECT public.combat2_dispatch_scheduler_fire();')=1 FROM cron.job WHERE jobname='combat2-dispatch-once'),
  'cron_job_count',(SELECT count(*) FROM cron.job WHERE jobname='combat2-dispatch-once'),
  'node_count',(SELECT count(*) FROM public.combat2_test_arena_node n WHERE n.arena_id=a.id AND n.active),
  'creature_count',(SELECT count(*) FROM public.combat2_test_arena_creature c WHERE c.arena_id=a.id),
  'tester_count',(SELECT count(*) FROM public.combat2_test_arena_access x WHERE x.arena_id=a.id AND x.active AND x.revoked_at IS NULL),
  'located_tester_count',(SELECT count(*) FROM public.combat2_test_arena_access x JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active WHERE x.arena_id=a.id AND x.active AND x.revoked_at IS NULL),
  'active_encounter_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.status='active'),
  'ordinary_encounter_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id IS NULL AND e.status='active'),
  'claimed_encounter_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=a.id AND e.claim_token IS NOT NULL),
  'live_claim_count',(SELECT count(*) FROM public.node_encounter e WHERE e.claim_token IS NOT NULL AND e.claim_expires_at>now()),
  'ordinary_live_claim_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id IS NULL AND e.claim_token IS NOT NULL AND e.claim_expires_at>now()),
  'recent_ordinary_player_count',(SELECT count(*) FROM public.characters c WHERE c.last_online>now()-interval '30 minutes' AND NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_access x WHERE x.arena_id=a.id AND x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=c.user_id AND r.role IN('steward','overlord'))),
  'pending_intent_count',(SELECT count(*) FROM public.node_intent i JOIN public.node_encounter e ON e.id=i.encounter_id WHERE e.test_arena_id=a.id AND i.status='pending'),
  'pending_event_count',(SELECT count(*) FROM public.node_pending_event p JOIN public.node_encounter e ON e.id=p.encounter_id WHERE e.test_arena_id=a.id AND p.consumed_at IS NULL),
  'diagnostic_history_exists',EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.test_arena_id=a.id),
  'nodes',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n.node_id,'purpose',n.purpose,'label',d.name,'active',n.active) ORDER BY n.purpose),'[]'::jsonb) FROM public.combat2_test_arena_node n JOIN public.nodes d ON d.id=n.node_id WHERE n.arena_id=a.id),
  'access',(SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',x.user_id,'character_id',x.character_id,'character_name',c.name,'active',x.active,'revoked',x.revoked_at IS NOT NULL) ORDER BY c.name),'[]'::jsonb) FROM public.combat2_test_arena_access x JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id WHERE x.arena_id=a.id),
  'last_operation',(SELECT r.result->>'kind' FROM public.combat2_test_arena_request r WHERE r.arena_id=a.id ORDER BY r.created_at DESC LIMIT 1),
  'last_start_classification',(SELECT r.result->>'kind' FROM public.combat2_test_arena_request r WHERE r.arena_id=a.id AND r.operation='environment_start' ORDER BY r.created_at DESC LIMIT 1),
  'last_close_classification',(SELECT r.result->>'kind' FROM public.combat2_test_arena_request r WHERE r.arena_id=a.id AND r.operation='environment_close' ORDER BY r.created_at DESC LIMIT 1)
 ) INTO out FROM public.combat2_test_arena a WHERE a.id=_arena_id;
 RETURN COALESCE(out,jsonb_build_object('ok',false,'kind','unknown_arena'));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','status_failed');
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_environment_start(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE prior public.combat2_test_arena_request; result jsonb; caller uuid:=auth.uid(); jobs integer; exact_jobs integer; scheduler jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
 IF FOUND THEN IF prior.arena_id<>_arena_id OR prior.operation<>'environment_start' OR prior.caller_id IS DISTINCT FROM caller THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF; RETURN prior.result; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_access x JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active WHERE x.arena_id=_arena_id AND x.active AND x.revoked_at IS NULL) THEN RETURN jsonb_build_object('ok',false,'kind','located_tester_required'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND claim_token IS NOT NULL AND claim_expires_at>now()) THEN RETURN jsonb_build_object('ok',false,'kind','arena_claim_active'); END IF;
 SELECT count(*),count(*) FILTER(WHERE schedule='2 seconds' AND command='SELECT public.combat2_dispatch_scheduler_fire();') INTO jobs,exact_jobs FROM cron.job WHERE jobname='combat2-dispatch-once';
 IF public.combat_mode_is_open() AND public.world_state_is_awake() AND jobs=1 AND exact_jobs=1 THEN result:=jsonb_build_object('ok',true,'kind','already_started','combatMode','open','worldState','awake','schedulerEnabled',true,'cronJobCount',1); ELSE
  BEGIN
   UPDATE public.combat_config SET value='open' WHERE key='combat_mode';
   PERFORM public.wake_world();
   scheduler:=public.combat2_dispatch_scheduler_enable();
   SELECT count(*),count(*) FILTER(WHERE schedule='2 seconds' AND command='SELECT public.combat2_dispatch_scheduler_fire();') INTO jobs,exact_jobs FROM cron.job WHERE jobname='combat2-dispatch-once';
   IF NOT public.combat_mode_is_open() OR NOT public.world_state_is_awake() OR jobs<>1 OR exact_jobs<>1 OR COALESCE((scheduler->>'ok')::boolean,false)=false THEN RAISE EXCEPTION 'start verification failed'; END IF;
   result:=jsonb_build_object('ok',true,'kind','started','combatMode','open','worldState','awake','schedulerEnabled',true,'cronJobCount',1);
  EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('ok',false,'kind','start_failed'); END;
 END IF;
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result) VALUES(_request_id,_arena_id,'environment_start',caller,false,result); RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','start_failed');
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_environment_close(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE prior public.combat2_test_arena_request; result jsonb; stopped jsonb; caller uuid:=auth.uid(); stop_id uuid; ordinary_encounters integer; ordinary_claims integer; recent_players integer; jobs integer; was_globally_closed boolean;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
 IF FOUND THEN IF prior.arena_id<>_arena_id OR prior.operation<>'environment_close' OR prior.caller_id IS DISTINCT FROM caller THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF; RETURN prior.result; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 stop_id:=(substr(md5('combat2-close-stop:'||_request_id::text),1,8)||'-'||substr(md5('combat2-close-stop:'||_request_id::text),9,4)||'-4'||substr(md5('combat2-close-stop:'||_request_id::text),14,3)||'-8'||substr(md5('combat2-close-stop:'||_request_id::text),18,3)||'-'||substr(md5('combat2-close-stop:'||_request_id::text),21,12))::uuid;
 stopped:=public.combat2_test_stop(_arena_id,stop_id);
 IF COALESCE((stopped->>'ok')::boolean,false)=false THEN RAISE EXCEPTION 'arena stop failed'; END IF;
 SELECT count(*) INTO ordinary_encounters FROM public.node_encounter WHERE test_arena_id IS NULL AND status='active';
 SELECT count(*) INTO ordinary_claims FROM public.node_encounter WHERE test_arena_id IS NULL AND claim_token IS NOT NULL AND claim_expires_at>now();
 SELECT count(*) INTO recent_players FROM public.characters c WHERE c.last_online>now()-interval '30 minutes' AND NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_access x WHERE x.arena_id=_arena_id AND x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=c.user_id AND r.role IN('steward','overlord'));
 IF ordinary_encounters+ordinary_claims+recent_players>0 THEN result:=jsonb_build_object('ok',true,'kind','arena_stopped_world_left_open','ordinaryEncounterCount',ordinary_encounters,'ordinaryLiveClaimCount',ordinary_claims,'recentOrdinaryPlayerCount',recent_players);
 ELSE
  was_globally_closed:=NOT public.combat_mode_is_open() AND NOT public.world_state_is_awake() AND NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='combat2-dispatch-once');
  BEGIN
   UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
   PERFORM public.shutdown_world(); PERFORM public.combat2_dispatch_scheduler_disable();
   SELECT count(*) INTO jobs FROM cron.job WHERE jobname='combat2-dispatch-once';
   IF public.combat_mode_is_open() OR public.world_state_is_awake() OR jobs<>0 OR EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND claim_token IS NOT NULL AND claim_expires_at>now()) THEN RAISE EXCEPTION 'close verification failed'; END IF;
   result:=jsonb_build_object('ok',true,'kind',CASE WHEN stopped->>'kind'='already_stopped' AND was_globally_closed THEN 'already_closed' ELSE 'closed' END,'combatMode','maintenance','worldState','asleep','schedulerEnabled',false,'cronJobCount',0,'ordinaryEncounterCount',0,'ordinaryLiveClaimCount',0,'recentOrdinaryPlayerCount',0);
  EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('ok',false,'kind','close_failed'); END;
 END IF;
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result) VALUES(_request_id,_arena_id,'environment_close',caller,false,result); RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','close_failed');
END; $$;

REVOKE ALL ON FUNCTION public.combat2_test_status(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.combat2_test_environment_start(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.combat2_test_environment_close(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_status(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_environment_start(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_environment_close(uuid,uuid) TO authenticated,service_role;
