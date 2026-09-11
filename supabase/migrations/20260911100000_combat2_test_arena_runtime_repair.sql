-- Continuous Test Arena dispatch, bounded observability, and recording-stop diagnostics.

ALTER TABLE public.combat2_dispatch_schedule_state
  ADD COLUMN IF NOT EXISTS last_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_http_status integer,
  ADD COLUMN IF NOT EXISTS last_classification text,
  ADD COLUMN IF NOT EXISTS last_error_code text;

CREATE TABLE public.combat2_test_presence (
  arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(arena_id,character_id)
);
ALTER TABLE public.combat2_test_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.combat2_test_presence FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.combat2_test_presence TO service_role;

CREATE FUNCTION public.combat2_test_presence_heartbeat(_arena_id uuid,_character_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid();
BEGIN
 IF caller IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.combat2_test_arena_access x
  JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id
  JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active
  JOIN public.combat2_test_arena a ON a.id=x.arena_id AND a.active
  WHERE x.arena_id=_arena_id AND x.character_id=_character_id AND x.user_id=caller
    AND x.active AND x.revoked_at IS NULL
 ) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 INSERT INTO public.combat2_test_presence(arena_id,character_id,user_id,seen_at)
 VALUES(_arena_id,_character_id,caller,clock_timestamp())
 ON CONFLICT(arena_id,character_id) DO UPDATE
 SET user_id=EXCLUDED.user_id,seen_at=clock_timestamp();
 RETURN jsonb_build_object('ok',true,'kind','present');
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_presence_heartbeat(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_presence_heartbeat(uuid,uuid) TO authenticated,service_role;

-- Eligibility must be inside the ordered candidate query, before LIMIT.  The
-- previous wrapper limited globally and only then filtered, allowing ordinary
-- stale encounters to starve an eligible arena indefinitely.
CREATE OR REPLACE FUNCTION public.combat2_due_nodes(_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_limit integer:=LEAST(GREATEST(COALESCE(_limit,10),1),25); candidates jsonb;
BEGIN
 IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','maintenance','limit',v_limit,'candidate_count',0,'candidates','[]'::jsonb); END IF;
 IF NOT public.world_state_is_awake() THEN RETURN jsonb_build_object('ok',false,'kind','world_asleep','limit',v_limit,'candidate_count',0,'candidates','[]'::jsonb); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('node_id',due.node_id,'encounter_id',due.id,'next_due_at',due.next_due_at) ORDER BY due.next_due_at,due.node_id),'[]'::jsonb)
 INTO candidates FROM (
  SELECT e.id,e.node_id,e.next_due_at FROM public.node_encounter e
  WHERE e.status='active' AND e.next_due_at<=now()
    AND (e.claimed_tick IS NULL OR e.claim_expires_at IS NULL OR e.claim_expires_at<=now())
    AND public.combat2_node_runtime_eligible(e.node_id)
  ORDER BY e.next_due_at,e.node_id LIMIT v_limit
 ) due;
 RETURN jsonb_build_object('ok',true,'kind','candidates','limit',v_limit,'candidate_count',jsonb_array_length(candidates),'candidates',candidates);
END $$;
REVOKE ALL ON FUNCTION public.combat2_due_nodes(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_due_nodes(integer) TO service_role;

-- Consume the prior asynchronous response before queueing the next request.
-- Store only bounded classifications/status; never persist response bodies.
CREATE OR REPLACE FUNCTION public.combat2_dispatch_scheduler_fire()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,net,vault,pg_temp AS $$
DECLARE state public.combat2_dispatch_schedule_state%ROWTYPE; secret text; request bigint; response record; body jsonb; classification text; error_code text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('combat2-dispatch-once-fire')) THEN RETURN jsonb_build_object('ok',false,'classification','overlap_refused'); END IF;
 IF NOT public.combat2_dispatch_scheduler_eligible() THEN PERFORM public.combat2_dispatch_scheduler_disable(); RETURN jsonb_build_object('ok',false,'classification','ineligible'); END IF;
 SELECT * INTO state FROM public.combat2_dispatch_schedule_state WHERE singleton=true FOR UPDATE;
 IF state.request_id IS NOT NULL THEN
  SELECT status_code,error_msg,content INTO response FROM net._http_response WHERE id=state.request_id;
  IF FOUND THEN
   BEGIN body:=response.content::jsonb; EXCEPTION WHEN OTHERS THEN body:=NULL; END;
   classification:=CASE WHEN response.error_msg IS NOT NULL THEN 'transport_error' WHEN response.status_code IS NULL THEN 'transport_error'
    WHEN jsonb_typeof(body)='object' AND body->>'classification'~'^[a-z][a-z0-9_]*$' THEN body->>'classification'
    WHEN response.status_code BETWEEN 200 AND 299 THEN 'malformed_success' ELSE 'http_error' END;
   error_code:=CASE WHEN response.error_msg IS NOT NULL THEN 'transport_error' WHEN response.status_code IS NULL THEN 'missing_status'
    WHEN jsonb_typeof(body)<>'object' OR body IS NULL THEN 'malformed_response'
    WHEN body->>'ok' IS DISTINCT FROM 'true' THEN NULLIF(body->>'classification','') ELSE NULL END;
   IF error_code IS NULL AND jsonb_typeof(body->'results')='array' THEN
    SELECT item->>'classification' INTO error_code FROM jsonb_array_elements(body->'results') item
    WHERE item->>'classification' NOT IN('committed','already_committed','not_due','in_flight','no_claim')
      AND item->>'classification'~'^[a-z][a-z0-9_]*$' LIMIT 1;
   END IF;
   UPDATE public.combat2_dispatch_schedule_state SET request_id=NULL,requested_at=NULL,last_response_at=clock_timestamp(),
    last_success_at=CASE WHEN response.status_code BETWEEN 200 AND 299 AND body->>'ok'='true' AND error_code IS NULL THEN clock_timestamp() ELSE last_success_at END,
    last_http_status=response.status_code,last_classification=classification,last_error_code=error_code WHERE singleton=true;
   DELETE FROM net._http_response WHERE id=state.request_id;
  ELSIF state.requested_at>clock_timestamp()-interval '15 seconds' THEN RETURN jsonb_build_object('ok',false,'classification','overlap_refused');
  ELSE
   UPDATE public.combat2_dispatch_schedule_state SET request_id=NULL,requested_at=NULL,last_response_at=clock_timestamp(),
    last_http_status=NULL,last_classification='timeout',last_error_code='no_response_within_15s' WHERE singleton=true;
  END IF;
 END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='COMBAT2_WORKER_SECRET';
 IF secret IS NULL OR secret='' THEN PERFORM public.combat2_dispatch_scheduler_disable(); RETURN jsonb_build_object('ok',false,'classification','secret_unavailable'); END IF;
 SELECT net.http_post(url:='https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/combat2-dispatch-once',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret),body:='{}'::jsonb,timeout_milliseconds:=12000) INTO request;
 UPDATE public.combat2_dispatch_schedule_state SET request_id=request,requested_at=clock_timestamp() WHERE singleton=true;
 RETURN jsonb_build_object('ok',true,'classification','queued');
END $$;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_fire() TO service_role;

-- Freeze only the report.  Keep replay identity and expose a bounded SQLSTATE
-- and stage if this public/admin wrapper reaches a terminal database error.
CREATE OR REPLACE FUNCTION public.combat2_test_run_stop(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); active_run public.combat2_test_run; prior public.combat2_test_run; boundary bigint; summary jsonb; failure_code text; failure_stage text:='select_run';
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_run WHERE stop_request_id=_request_id;
 IF FOUND THEN
  IF prior.arena_id<>_arena_id OR prior.initiated_by IS DISTINCT FROM caller THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'kind','already_completed','run_id',prior.id,'status',prior.status,'started_at',prior.started_at,'completed_at',prior.completed_at,'latest_seq',prior.final_seq,'summary',prior.final_summary);
 END IF;
 SELECT * INTO active_run FROM public.combat2_test_run WHERE arena_id=_arena_id AND status='recording' FOR UPDATE;
 IF NOT FOUND THEN
  SELECT * INTO prior FROM public.combat2_test_run WHERE arena_id=_arena_id AND status='completed' AND initiated_by IS NOT DISTINCT FROM caller ORDER BY completed_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'kind','already_completed','run_id',prior.id,'status',prior.status,'started_at',prior.started_at,'completed_at',prior.completed_at,'latest_seq',prior.final_seq,'summary',prior.final_summary); END IF;
  RETURN jsonb_build_object('ok',false,'kind','no_recording_run');
 END IF;
 failure_stage:='summarize';
 SELECT COALESCE(max(b.seq),0),jsonb_build_object(
  'encounter_count',count(DISTINCT b.encounter_id),'batch_count',count(DISTINCT b.batch_id),'event_count',count(*) FILTER(WHERE e.event IS NOT NULL),
  'player_basic_attacks',count(*) FILTER(WHERE e.event->>'kind'='attack' AND e.event->>'abilityKey' IS NULL),
  'abilities',count(*) FILTER(WHERE e.event#>>'{actor,type}'='character' AND e.event ? 'abilityKey'),
  'creature_attacks',count(*) FILTER(WHERE e.event->>'kind'='creature_attack'),
  'misses',count(*) FILTER(WHERE e.event->>'hitQuality'='miss' OR e.event->>'outcomeReason' IN('missed','critical_miss')),
  'crits',count(*) FILTER(WHERE e.event->>'hitQuality' IN('crit','critical','strong') OR e.event#>>'{meta,isCrit}'='true'),
  'healing',count(*) FILTER(WHERE e.event->>'kind' IN('heal','hp_transfer') OR (e.event->>'kind'='effect_pulse' AND e.event#>>'{meta,healing}'='true')),
  'damage_prevented',COALESCE(sum(CASE WHEN jsonb_typeof(e.event#>'{meta,percentMitigated}')='number' THEN (e.event#>>'{meta,percentMitigated}')::numeric ELSE 0 END+CASE WHEN jsonb_typeof(e.event#>'{meta,flatMitigated}')='number' THEN (e.event#>>'{meta,flatMitigated}')::numeric ELSE 0 END+CASE WHEN jsonb_typeof(e.event#>'{meta,blocked}')='number' THEN (e.event#>>'{meta,blocked}')::numeric ELSE 0 END),0),
  'absorbed_damage',COALESCE(sum(CASE WHEN jsonb_typeof(e.event#>'{meta,absorbed}')='number' THEN (e.event#>>'{meta,absorbed}')::numeric ELSE 0 END),0),
  'effect_events',count(*) FILTER(WHERE e.event->>'kind' IN('dot_applied','debuff_applied','buff_applied','effect_pulse','effect_expired')),
  'opportunity_attacks',count(*) FILTER(WHERE e.event->>'kind' LIKE 'opportunity%'),
  'movement_flee',count(*) FILTER(WHERE e.event->>'kind' IN('fighter_fled','fighter_moved','fighter_exit_failed')),
  'deaths',count(*) FILTER(WHERE e.event->>'kind' IN('character_died','creature_died')),
  'diagnostic_events',count(*) FILTER(WHERE e.event->>'kind' IN('action_rejected','fighter_exit_failed')))
 INTO boundary,summary FROM public.combat2_test_run_batch b LEFT JOIN public.combat2_test_run_event e ON e.run_id=b.run_id AND e.batch_id=b.batch_id WHERE b.run_id=active_run.id;
 failure_stage:='finalize';
 UPDATE public.combat2_test_run SET status='completed',completed_at=clock_timestamp(),stop_request_id=_request_id,final_seq=boundary,final_summary=summary WHERE id=active_run.id RETURNING * INTO active_run;
 RETURN jsonb_build_object('ok',true,'kind','completed','run_id',active_run.id,'status','completed','started_at',active_run.started_at,'completed_at',active_run.completed_at,'latest_seq',boundary,'summary',summary);
EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE;
 RETURN jsonb_build_object('ok',false,'kind','run_stop_failed','stage',failure_stage,'code',CASE WHEN failure_code~'^[[:alnum:]]{5}$' THEN failure_code ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_run_stop(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_run_stop(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.idle_shutdown_check() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.characters WHERE last_online>now()-interval '30 minutes') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_test_presence p JOIN public.combat2_test_arena_access x ON x.arena_id=p.arena_id AND x.character_id=p.character_id AND x.user_id=p.user_id AND x.active AND x.revoked_at IS NULL JOIN public.characters c ON c.id=p.character_id AND c.user_id=p.user_id JOIN public.combat2_test_arena_node n ON n.arena_id=p.arena_id AND n.node_id=c.current_node_id AND n.active WHERE p.seen_at>now()-interval '5 minutes') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE claim_token IS NOT NULL AND claim_expires_at>now()) THEN RETURN; END IF;
 BEGIN PERFORM public.return_unique_items(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'return_unique_items() failed during shutdown: %',SQLERRM; END;
 UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
 PERFORM public.combat2_dispatch_scheduler_disable(); PERFORM public.shutdown_world();
END $$;
REVOKE ALL ON FUNCTION public.idle_shutdown_check() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.idle_shutdown_check() TO service_role;

-- Extend the existing authorized status surface with bounded runtime health.
CREATE OR REPLACE FUNCTION public.combat2_test_runtime_status(_arena_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE base jsonb; schedule public.combat2_dispatch_schedule_state%ROWTYPE;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 base:=public.combat2_test_status(_arena_id); IF COALESCE((base->>'ok')::boolean,false)=false THEN RETURN base; END IF;
 SELECT * INTO schedule FROM public.combat2_dispatch_schedule_state WHERE singleton=true;
 RETURN base||jsonb_build_object(
  'last_dispatcher_at',schedule.last_response_at,'last_successful_dispatcher_at',schedule.last_success_at,'last_dispatcher_classification',schedule.last_classification,
  'last_dispatcher_http_status',schedule.last_http_status,'last_dispatcher_error_code',schedule.last_error_code,
  'last_arena_tick',(SELECT max(e.tick) FROM public.node_encounter e WHERE e.test_arena_id=_arena_id),
  'last_arena_tick_at',(SELECT max(b.created_at) FROM public.node_tick_batch b JOIN public.node_encounter e ON e.id=b.encounter_id WHERE e.test_arena_id=_arena_id),
  'arena_live_claim_count',(SELECT count(*) FROM public.node_encounter e WHERE e.test_arena_id=_arena_id AND e.claim_token IS NOT NULL AND e.claim_expires_at>now()),
  'recording_status',COALESCE((SELECT r.status FROM public.combat2_test_run r WHERE r.arena_id=_arena_id ORDER BY (r.status='recording') DESC,r.started_at DESC LIMIT 1),'none'));
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_runtime_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_runtime_status(uuid) TO authenticated,service_role;
