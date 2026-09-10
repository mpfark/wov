-- Repair Test Arena finalization without weakening node_pending_event_consumed_chk.
CREATE FUNCTION public.combat2_test_finalize_pending_events(_arena_id uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.node_pending_event p
     SET consumed_at=now(), consumed_tick=e.tick
    FROM public.node_encounter e
   WHERE e.id=p.encounter_id AND e.test_arena_id=_arena_id
     AND p.consumed_at IS NULL AND p.consumed_tick IS NULL;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_finalize_pending_events(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_finalize_pending_events(uuid) TO service_role;

-- Keep the installed stop implementation and put the contract repair in front
-- of every caller: normal stop, environment close and emergency stop.
ALTER FUNCTION public.combat2_test_stop(uuid,uuid) RENAME TO combat2_test_stop_without_event_finalization;
REVOKE ALL ON FUNCTION public.combat2_test_stop_without_event_finalization(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_stop_without_event_finalization(uuid,uuid) TO service_role;
CREATE FUNCTION public.combat2_test_stop(_arena_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); prior public.combat2_test_arena_request;
BEGIN
  IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
  SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
  IF FOUND THEN
    IF prior.arena_id<>_arena_id OR prior.operation<>'stop' OR prior.caller_id IS DISTINCT FROM caller
      THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
    RETURN prior.result;
  END IF;
  PERFORM public.combat2_test_finalize_pending_events(_arena_id);
  RETURN public.combat2_test_stop_without_event_finalization(_arena_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_stop(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_stop(uuid,uuid) TO authenticated,service_role;

-- Recording completion freezes the evidence boundary only. It no longer stops
-- encounters or depends on the arena stop lifecycle.
CREATE OR REPLACE FUNCTION public.combat2_test_run_stop(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); active_run public.combat2_test_run; prior public.combat2_test_run; boundary bigint; summary jsonb;
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
 SELECT COALESCE(max(seq),0) INTO boundary FROM public.combat2_test_run_batch WHERE run_id=active_run.id;
 SELECT jsonb_build_object(
  'encounter_count',count(DISTINCT b.encounter_id),'batch_count',count(DISTINCT b.batch_id),'event_count',count(e.event),
  'player_basic_attacks',count(e.event) FILTER(WHERE e.event->>'kind'='attack' AND e.event->>'abilityKey' IS NULL),
  'abilities',count(e.event) FILTER(WHERE e.event#>>'{actor,type}'='character' AND e.event ? 'abilityKey'),
  'creature_attacks',count(e.event) FILTER(WHERE e.event->>'kind'='creature_attack'),
  'misses',count(e.event) FILTER(WHERE e.event->>'hitQuality'='miss' OR e.event->>'outcomeReason' IN('missed','critical_miss')),
  'crits',count(e.event) FILTER(WHERE e.event->>'hitQuality' IN('crit','critical','strong') OR e.event#>>'{meta,isCrit}'='true'),
  'healing',count(e.event) FILTER(WHERE e.event->>'kind' IN('heal','hp_transfer') OR (e.event->>'kind'='effect_pulse' AND e.event#>>'{meta,healing}'='true')),
  'damage_prevented',COALESCE(sum(CASE WHEN jsonb_typeof(e.event#>'{meta,percentMitigated}')='number' THEN (e.event#>>'{meta,percentMitigated}')::numeric ELSE 0 END+CASE WHEN jsonb_typeof(e.event#>'{meta,flatMitigated}')='number' THEN (e.event#>>'{meta,flatMitigated}')::numeric ELSE 0 END+CASE WHEN jsonb_typeof(e.event#>'{meta,blocked}')='number' THEN (e.event#>>'{meta,blocked}')::numeric ELSE 0 END),0),
  'absorbed_damage',COALESCE(sum(CASE WHEN jsonb_typeof(e.event#>'{meta,absorbed}')='number' THEN (e.event#>>'{meta,absorbed}')::numeric ELSE 0 END),0),
  'effect_events',count(e.event) FILTER(WHERE e.event->>'kind' IN('dot_applied','debuff_applied','buff_applied','effect_pulse','effect_expired')),
  'opportunity_attacks',count(e.event) FILTER(WHERE e.event->>'kind' LIKE 'opportunity%'),
  'movement_flee',count(e.event) FILTER(WHERE e.event->>'kind' IN('fighter_fled','fighter_moved','fighter_exit_failed')),
  'deaths',count(e.event) FILTER(WHERE e.event->>'kind' IN('character_died','creature_died')),
  'diagnostic_events',count(e.event) FILTER(WHERE e.event->>'kind' IN('action_rejected','fighter_exit_failed'))
 ) INTO summary FROM public.combat2_test_run_batch b LEFT JOIN public.combat2_test_run_event e ON e.run_id=b.run_id AND e.batch_id=b.batch_id WHERE b.run_id=active_run.id;
 UPDATE public.combat2_test_run SET status='completed',completed_at=now(),stop_request_id=_request_id,final_seq=boundary,final_summary=summary WHERE id=active_run.id RETURNING * INTO active_run;
 RETURN jsonb_build_object('ok',true,'kind','completed','run_id',active_run.id,'status','completed','started_at',active_run.started_at,'completed_at',active_run.completed_at,'latest_seq',boundary,'summary',summary);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','run_stop_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_run_stop(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_run_stop(uuid,uuid) TO authenticated,service_role;

-- Explicit movement eligibility: active nodes in the same active Test Arena do
-- not need an ordinary canary row. Ordinary movement retains canary gating.
CREATE FUNCTION public.combat2_movement_scope_eligible(_origin uuid,_destination uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.combat2_test_arena_node o
   JOIN public.combat2_test_arena a ON a.id=o.arena_id AND a.active
   JOIN public.combat2_test_arena_node d ON d.arena_id=o.arena_id AND d.active
   WHERE o.node_id=_origin AND o.active AND d.node_id=_destination
 ) OR (
   public.combat2_node_runtime_eligible(_origin)
   AND EXISTS(SELECT 1 FROM public.combat2_canary_node c WHERE c.node_id=_destination AND c.enabled AND c.expires_at>now())
 )
$$;
REVOKE ALL ON FUNCTION public.combat2_movement_scope_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_movement_scope_eligible(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_depart(_character_id uuid,_destination_node_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE origin uuid;
BEGIN
 SELECT current_node_id INTO origin FROM public.characters WHERE id=_character_id;
 IF NOT public.combat2_movement_scope_eligible(origin,_destination_node_id) THEN RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','destination_not_enabled'); END IF;
 RETURN public.combat2_depart_without_canary_gate(_character_id,_destination_node_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_depart(uuid,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.combat2_party_depart(_leader_character_id uuid,_destination_node_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE origin uuid;
BEGIN
 SELECT current_node_id INTO origin FROM public.characters WHERE id=_leader_character_id;
 IF NOT public.combat2_movement_scope_eligible(origin,_destination_node_id) THEN RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','destination_not_enabled'); END IF;
 RETURN public.combat2_party_depart_without_canary_gate(_leader_character_id,_destination_node_id,_request_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role;

-- Existing inactivity owner now closes Combat2 scheduling as well. A live
-- claim is allowed only its established bounded completion/expiry window.
CREATE OR REPLACE FUNCTION public.idle_shutdown_check() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,cron,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.characters WHERE last_online>now()-interval '30 minutes') THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE claim_token IS NOT NULL AND claim_expires_at>now()) THEN RETURN; END IF;
 BEGIN PERFORM public.return_unique_items(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'return_unique_items() failed during shutdown: %',SQLERRM; END;
 UPDATE public.combat_config SET value='maintenance' WHERE key='combat_mode';
 PERFORM public.combat2_dispatch_scheduler_disable();
 PERFORM public.shutdown_world();
END $$;
REVOKE ALL ON FUNCTION public.idle_shutdown_check() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.idle_shutdown_check() TO service_role;