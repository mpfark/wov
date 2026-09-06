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

REVOKE ALL ON FUNCTION public.combat2_test_environment_close(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_environment_close(uuid,uuid) TO authenticated,service_role;