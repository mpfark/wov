-- Repair the effective commit fence and make Test Arena activation automatic.

-- JSON null is a JSONB value, not SQL NULL. The installed equipment fence
-- compared database NULL stat_override with JSONB 'null', rejecting an
-- unchanged equipped item as stale_equipment on every tick.
DO $migration$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
 IF position('value->''stat_override'' stat_override' in d)=0
    OR position('NULLIF(value->''stat_override'',''null''::jsonb) stat_override' in d)>0
 THEN RAISE EXCEPTION 'unexpected node_tick_commit stat_override fence contract'; END IF;
 d:=replace(d,'value->''stat_override'' stat_override','NULLIF(value->''stat_override'',''null''::jsonb) stat_override');
 IF position('NULLIF(value->''stat_override'',''null''::jsonb) stat_override' in d)=0
 THEN RAISE EXCEPTION 'node_tick_commit stat_override fence repair failed'; END IF;
 EXECUTE d;
END $migration$;

-- Convert database exceptions to a bounded JSON contract. The inner function
-- retains all installed validation, locking, mutation, and idempotency logic.
ALTER FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
 RENAME TO node_tick_commit_without_bounded_failure;
REVOKE ALL ON FUNCTION public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit_without_bounded_failure(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;

CREATE FUNCTION public.node_tick_commit(
 _encounter_id uuid,_claim_token uuid,_candidate_tick integer,_expected_last_tick integer,
 _expected_state_version bigint,_intent_ids uuid[],_proposed jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; failure_code text;
BEGIN
 result:=public.node_tick_commit_without_bounded_failure(_encounter_id,_claim_token,_candidate_tick,
  _expected_last_tick,_expected_state_version,_intent_ids,_proposed);
 IF jsonb_typeof(result)<>'object' OR result->>'ok' IS NULL OR result->>'kind' IS NULL THEN
  RETURN jsonb_build_object('ok',false,'kind','internal_failure','code','P0001');
 END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE;
 RETURN jsonb_build_object('ok',false,'kind','internal_failure','code',
  CASE WHEN failure_code~'^[[:alnum:]]{5}$' THEN failure_code ELSE 'P0001' END);
END $$;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;

-- Arena access is the activation boundary. Identity, ownership, registration,
-- current location, time, world state, and scheduler state are all server-owned.
CREATE OR REPLACE FUNCTION public.combat2_session_access(_character_id uuid,_node_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); arena uuid; scheduler jsonb;
BEGIN
 IF caller IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.user_id=caller AND c.current_node_id=_node_id
 ) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;

 SELECT n.arena_id INTO arena FROM public.combat2_test_arena_node n
 JOIN public.combat2_test_arena a ON a.id=n.arena_id AND a.active
 WHERE n.node_id=_node_id AND n.active;
 IF arena IS NOT NULL THEN
  IF NOT public.combat2_test_arena_access_allowed(caller,_character_id,_node_id) THEN
   RETURN jsonb_build_object('ok',false,'kind','not_authorized');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('combat2-test-auto-activation'));
  UPDATE public.combat_config SET value='open' WHERE key='combat_mode' AND value IS DISTINCT FROM 'open';
  PERFORM public.wake_world();
  scheduler:=public.combat2_dispatch_scheduler_enable();
  IF COALESCE(scheduler->>'ok','false')<>'true' THEN
   PERFORM public.combat2_dispatch_scheduler_disable();
   UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
   PERFORM public.shutdown_world();
   RETURN jsonb_build_object('ok',false,'kind','access_check_failed');
  END IF;
  INSERT INTO public.combat2_test_presence(arena_id,character_id,user_id,seen_at)
  VALUES(arena,_character_id,caller,clock_timestamp())
  ON CONFLICT(arena_id,character_id) DO UPDATE SET user_id=EXCLUDED.user_id,seen_at=clock_timestamp();
  RETURN jsonb_build_object('ok',true,'kind','allowed','node_id',_node_id,'scope','test_arena');
 END IF;

 IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','mode_refused'); END IF;
 IF NOT public.combat2_node_runtime_eligible(_node_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_enabled'); END IF;
 RETURN jsonb_build_object('ok',true,'kind','allowed','node_id',_node_id,'scope','canary');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','access_check_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_session_access(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_session_access(uuid,uuid) TO authenticated,service_role;

-- Only server-stamped, recently authenticated arena presence keeps an arena
-- awake. Browser-written characters.last_online remains relevant to ordinary
-- players, but cannot extend an arena session beyond the five-minute lease.
CREATE OR REPLACE FUNCTION public.idle_shutdown_check() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,pg_temp AS $$
BEGIN
 IF EXISTS(
  SELECT 1 FROM public.characters c WHERE c.last_online>now()-interval '30 minutes'
   AND NOT EXISTS(
    SELECT 1 FROM public.combat2_test_arena_access x
    JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active
    WHERE x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL
   )
 ) THEN RETURN; END IF;
 IF EXISTS(
  SELECT 1 FROM public.combat2_test_presence p
  JOIN public.combat2_test_arena_access x ON x.arena_id=p.arena_id AND x.character_id=p.character_id AND x.user_id=p.user_id AND x.active AND x.revoked_at IS NULL
  JOIN public.characters c ON c.id=p.character_id AND c.user_id=p.user_id
  JOIN public.combat2_test_arena_node n ON n.arena_id=p.arena_id AND n.node_id=c.current_node_id AND n.active
  WHERE p.seen_at>now()-interval '5 minutes'
 ) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE claim_token IS NOT NULL AND claim_expires_at>now()) THEN RETURN; END IF;
 BEGIN PERFORM public.return_unique_items(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'return_unique_items() failed during shutdown: %',SQLERRM; END;
 UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
 PERFORM public.combat2_dispatch_scheduler_disable();
 PERFORM public.shutdown_world();
END $$;
REVOKE ALL ON FUNCTION public.idle_shutdown_check() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.idle_shutdown_check() TO service_role;

-- Reset keeps its installed cleanup implementation, adding a server-side
-- active-presence fence before any destructive work.
ALTER FUNCTION public.combat2_test_reset(uuid,uuid,boolean) RENAME TO combat2_test_reset_without_presence_gate;
REVOKE ALL ON FUNCTION public.combat2_test_reset_without_presence_gate(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset_without_presence_gate(uuid,uuid,boolean) TO service_role;
CREATE FUNCTION public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_test_presence WHERE arena_id=_arena_id AND seen_at>now()-interval '5 minutes')
 THEN RETURN jsonb_build_object('ok',false,'kind','active_player'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND claim_token IS NOT NULL AND claim_expires_at>now())
 THEN RETURN jsonb_build_object('ok',false,'kind','live_claim'); END IF;
 RETURN public.combat2_test_reset_without_presence_gate(_arena_id,_request_id,_confirm_destroy_diagnostics);
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) TO authenticated,service_role;

ALTER TABLE public.combat2_test_arena_request DROP CONSTRAINT combat2_test_arena_request_operation_check;
ALTER TABLE public.combat2_test_arena_request ADD CONSTRAINT combat2_test_arena_request_operation_check
 CHECK(operation IN('stop','reset','environment_start','environment_close','emergency_shutdown'));

CREATE FUNCTION public.combat2_test_emergency_shutdown(_arena_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); prior public.combat2_test_arena_request; report_result jsonb; stop_result jsonb; result jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.arena_id<>_arena_id OR prior.operation<>'emergency_shutdown' OR prior.caller_id IS DISTINCT FROM caller
  THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN prior.result;
 END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_test_run WHERE arena_id=_arena_id AND status='recording') THEN
  report_result:=public.combat2_test_run_stop(_arena_id,gen_random_uuid());
  IF COALESCE(report_result->>'ok','false')<>'true' THEN RETURN jsonb_build_object('ok',false,'kind','report_stop_failed'); END IF;
 END IF;
 stop_result:=public.combat2_test_stop(_arena_id,gen_random_uuid());
 IF COALESCE(stop_result->>'ok','false')<>'true' THEN RETURN jsonb_build_object('ok',false,'kind','arena_stop_failed'); END IF;
 UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
 PERFORM public.combat2_dispatch_scheduler_disable();
 PERFORM public.shutdown_world();
 DELETE FROM public.combat2_test_presence WHERE arena_id=_arena_id;
 result:=jsonb_build_object('ok',true,'kind','emergency_shutdown','combatMode','maintenance','worldState','asleep','schedulerEnabled',false);
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result)
 VALUES(_request_id,_arena_id,'emergency_shutdown',caller,false,result);
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','emergency_shutdown_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_emergency_shutdown(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_emergency_shutdown(uuid,uuid) TO authenticated,service_role;

-- Historical manual lifecycle functions remain for service compatibility only.
REVOKE ALL ON FUNCTION public.combat2_test_environment_start(uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.combat2_test_environment_close(uuid,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.combat2_test_stop(uuid,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_environment_start(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_environment_close(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_stop(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_test_runtime_status(_arena_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE base jsonb; schedule public.combat2_dispatch_schedule_state%ROWTYPE;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 base:=public.combat2_test_status(_arena_id); IF COALESCE(base->>'ok','false')<>'true' THEN RETURN base; END IF;
 SELECT * INTO schedule FROM public.combat2_dispatch_schedule_state WHERE singleton=true;
 RETURN base||jsonb_build_object(
  'last_dispatcher_at',schedule.last_response_at,'last_successful_dispatcher_at',schedule.last_success_at,
  'last_dispatcher_classification',schedule.last_classification,'last_dispatcher_http_status',schedule.last_http_status,
  'last_dispatcher_error_code',schedule.last_error_code,
  'last_arena_tick',(SELECT max(e.tick) FROM public.node_encounter e WHERE e.test_arena_id=_arena_id),
  'last_arena_tick_at',(SELECT max(b.created_at) FROM public.node_tick_batch b JOIN public.node_encounter e ON e.id=b.encounter_id WHERE e.test_arena_id=_arena_id),
  'arena_live_claim_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=_arena_id AND e.claim_token IS NOT NULL AND e.claim_expires_at>now()),
  'active_presence_count',(SELECT count(*) FROM public.combat2_test_presence p WHERE p.arena_id=_arena_id AND p.seen_at>now()-interval '5 minutes'),
  'recording_status',COALESCE((SELECT r.status FROM public.combat2_test_run r WHERE r.arena_id=_arena_id ORDER BY (r.status='recording') DESC,r.started_at DESC LIMIT 1),'none'));
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_runtime_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_runtime_status(uuid) TO authenticated,service_role;