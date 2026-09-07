-- Durable, admin-only Combat2 Test Arena diagnostic runs and safe reports.
CREATE TABLE public.combat2_test_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(status IN('recording','completed')),
 started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 initiated_by uuid,
 start_request_id uuid NOT NULL UNIQUE,
 stop_request_id uuid UNIQUE,
 final_seq bigint,
 final_summary jsonb,
 CHECK((status='recording' AND completed_at IS NULL AND stop_request_id IS NULL AND final_seq IS NULL)
    OR (status='completed' AND completed_at IS NOT NULL AND stop_request_id IS NOT NULL AND final_seq IS NOT NULL))
);
CREATE UNIQUE INDEX combat2_test_run_one_recording_per_arena ON public.combat2_test_run(arena_id) WHERE status='recording';
CREATE INDEX combat2_test_run_arena_started ON public.combat2_test_run(arena_id,started_at DESC);

CREATE TABLE public.combat2_test_run_batch (
 run_id uuid NOT NULL REFERENCES public.combat2_test_run(id) ON DELETE CASCADE,
 batch_id uuid NOT NULL UNIQUE,
 encounter_id uuid NOT NULL,
 tick integer NOT NULL,
 seq bigint NOT NULL,
 committed_at timestamptz NOT NULL,
 PRIMARY KEY(run_id,batch_id),
 UNIQUE(run_id,seq)
);

-- Safe event rows are archived separately because Reset intentionally removes the
-- source encounter/batch graph while completed reports must remain durable.
CREATE TABLE public.combat2_test_run_event (
 run_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 event_seq integer NOT NULL,
 event jsonb NOT NULL,
 PRIMARY KEY(run_id,batch_id,event_seq),
 FOREIGN KEY(run_id,batch_id) REFERENCES public.combat2_test_run_batch(run_id,batch_id) ON DELETE CASCADE
);

ALTER TABLE public.combat2_test_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_run_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_run_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.combat2_test_run,public.combat2_test_run_batch,public.combat2_test_run_event FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.combat2_test_run,public.combat2_test_run_batch,public.combat2_test_run_event TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_test_safe_event(_event jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'seq',_event->'seq','kind',_event->'kind',
  'actor',CASE WHEN jsonb_typeof(_event->'actor')='object' THEN jsonb_strip_nulls(jsonb_build_object('type',_event#>>'{actor,type}','id',_event#>>'{actor,id}','name',_event#>>'{actor,name}')) END,
  'target',CASE WHEN jsonb_typeof(_event->'target')='object' THEN jsonb_strip_nulls(jsonb_build_object('type',_event#>>'{target,type}','id',_event#>>'{target,id}','name',_event#>>'{target,name}')) END,
  'abilityKey',_event->'abilityKey','amount',_event->'amount','hitQuality',_event->'hitQuality','outcomeReason',_event->'outcomeReason',
  'eventType',_event->'eventType','actorCharacterId',_event->'actorCharacterId','actorCreatureId',_event->'actorCreatureId',
  'targetCharacterId',_event->'targetCharacterId','targetCreatureId',_event->'targetCreatureId','occurredAt',_event->'occurredAt',
  'meta',CASE WHEN jsonb_typeof(_event->'meta')='object' THEN jsonb_strip_nulls(jsonb_build_object(
   'effectKind',_event#>'{meta,effectKind}','effectType',_event#>'{meta,effectType}','durationMs',_event#>'{meta,durationMs}',
   'intervalMs',_event#>'{meta,intervalMs}','stance',_event#>'{meta,stance}','attacks',_event#>'{meta,attacks}',
   'reserveHp',_event#>'{meta,reserveHp}','blockChance',_event#>'{meta,blockChance}','mode',_event#>'{meta,mode}',
   'isTaunt',_event#>'{meta,isTaunt}','stacks',_event#>'{meta,stacks}','maxStacks',_event#>'{meta,maxStacks}',
   'stackNoun',_event#>'{meta,stackNoun}','refunded',_event#>'{meta,refunded}','conflictsWith',_event#>'{meta,conflictsWith}',
   'reservePct',_event#>'{meta,reservePct}','resolveAtTick',_event#>'{meta,resolveAtTick}','text',_event#>'{meta,text}',
   'isCrit',_event#>'{meta,isCrit}','percentMitigated',_event#>'{meta,percentMitigated}','shieldBonusApplied',_event#>'{meta,shieldBonusApplied}',
   'critSoftened',_event#>'{meta,critSoftened}','flatMitigated',_event#>'{meta,flatMitigated}','blocked',_event#>'{meta,blocked}',
   'absorbed',_event#>'{meta,absorbed}','reactive',_event#>'{meta,reactive}','damageType',_event#>'{meta,damageType}',
   'healing',_event#>'{meta,healing}','deathCry',_event#>'{meta,deathCry}','killedBy',_event#>'{meta,killedBy}'
  )) END));
$$;
REVOKE ALL ON FUNCTION public.combat2_test_safe_event(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.combat2_test_attach_committed_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE arena uuid; active_run uuid; next_seq bigint; item record; projected jsonb;
BEGIN
 SELECT e.test_arena_id INTO arena FROM public.node_encounter e WHERE e.id=NEW.encounter_id;
 IF arena IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||arena::text,0));
 SELECT r.id INTO active_run FROM public.combat2_test_run r WHERE r.arena_id=arena AND r.status='recording' FOR UPDATE;
 IF active_run IS NULL THEN RETURN NEW; END IF;
 SELECT COALESCE(max(b.seq),0)+1 INTO next_seq FROM public.combat2_test_run_batch b WHERE b.run_id=active_run;
 INSERT INTO public.combat2_test_run_batch(run_id,batch_id,encounter_id,tick,seq,committed_at)
 VALUES(active_run,NEW.id,NEW.encounter_id,NEW.tick,next_seq,NEW.created_at) ON CONFLICT(batch_id) DO NOTHING;
 IF FOUND THEN
  FOR item IN SELECT value,ordinality FROM jsonb_array_elements(COALESCE(NEW.events,'[]'::jsonb)) WITH ORDINALITY LOOP
   projected:=public.combat2_test_safe_event(item.value);
   IF projected ? 'kind' THEN INSERT INTO public.combat2_test_run_event(run_id,batch_id,event_seq,event) VALUES(active_run,NEW.id,item.ordinality,projected); END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.combat2_test_attach_committed_batch() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS combat2_test_attach_committed_batch ON public.node_tick_batch;
CREATE TRIGGER combat2_test_attach_committed_batch AFTER INSERT ON public.node_tick_batch
FOR EACH ROW EXECUTE FUNCTION public.combat2_test_attach_committed_batch();

CREATE OR REPLACE FUNCTION public.combat2_test_run_start(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,cron,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); prior public.combat2_test_run; current_run public.combat2_test_run; ready boolean;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_run WHERE start_request_id=_request_id;
 IF FOUND THEN
  IF prior.arena_id<>_arena_id OR prior.initiated_by IS DISTINCT FROM caller THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'kind',CASE WHEN prior.status='recording' THEN 'started' ELSE 'already_completed' END,'run_id',prior.id,'status',prior.status,
   'started_at',prior.started_at,'completed_at',prior.completed_at,'environment_ready',public.combat_mode_is_open() AND public.world_state_is_awake() AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='combat2-dispatch-once'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_access x JOIN public.characters c ON c.id=x.character_id AND c.user_id=x.user_id JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active WHERE x.arena_id=_arena_id AND x.active AND x.revoked_at IS NULL) THEN RETURN jsonb_build_object('ok',false,'kind','located_tester_required'); END IF;
 SELECT * INTO current_run FROM public.combat2_test_run WHERE arena_id=_arena_id AND status='recording';
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'kind','already_recording','run_id',current_run.id,'status','recording','started_at',current_run.started_at,
  'environment_ready',public.combat_mode_is_open() AND public.world_state_is_awake() AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='combat2-dispatch-once')); END IF;
 ready:=public.combat_mode_is_open() AND public.world_state_is_awake() AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='combat2-dispatch-once');
 INSERT INTO public.combat2_test_run(arena_id,status,initiated_by,start_request_id) VALUES(_arena_id,'recording',caller,_request_id) RETURNING * INTO current_run;
 RETURN jsonb_build_object('ok',true,'kind','started','run_id',current_run.id,'status','recording','started_at',current_run.started_at,'environment_ready',ready,
  'warning',CASE WHEN ready THEN NULL ELSE 'environment_closed' END);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','run_start_failed');
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_run_stop(_arena_id uuid,_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); active_run public.combat2_test_run; prior public.combat2_test_run; stopped jsonb; stop_request uuid; boundary bigint; summary jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_run WHERE stop_request_id=_request_id;
 IF FOUND THEN
  IF prior.arena_id<>_arena_id OR prior.initiated_by IS DISTINCT FROM caller THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'kind','already_completed','run_id',prior.id,'status',prior.status,'started_at',prior.started_at,'completed_at',prior.completed_at,'latest_seq',prior.final_seq,'summary',prior.final_summary);
 END IF;
 SELECT * INTO active_run FROM public.combat2_test_run WHERE arena_id=_arena_id AND status='recording' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','no_recording_run'); END IF;
 stop_request:=gen_random_uuid(); stopped:=public.combat2_test_stop(_arena_id,stop_request);
 IF COALESCE((stopped->>'ok')::boolean,false)=false THEN RETURN jsonb_build_object('ok',false,'kind','run_stop_failed'); END IF;
 SELECT COALESCE(max(seq),0) INTO boundary FROM public.combat2_test_run_batch WHERE run_id=active_run.id;
 SELECT jsonb_build_object(
  'encounter_count',count(DISTINCT b.encounter_id),'batch_count',count(DISTINCT b.batch_id),'event_count',count(e.event),
  'player_basic_attacks',count(e.event) FILTER(WHERE e.event->>'kind'='attack' AND e.event->>'abilityKey' IS NULL),
  'abilities',count(e.event) FILTER(WHERE e.event#>>'{actor,type}'='character' AND e.event ? 'abilityKey'),
  'creature_attacks',count(e.event) FILTER(WHERE e.event->>'kind'='creature_attack'),
  'misses',count(e.event) FILTER(WHERE e.event->>'hitQuality'='miss' OR e.event->>'outcomeReason' IN('missed','critical_miss')),
  'crits',count(e.event) FILTER(WHERE e.event->>'hitQuality' IN('crit','critical','strong') OR e.event#>>'{meta,isCrit}'='true'),
  'healing',count(e.event) FILTER(WHERE e.event->>'kind' IN('heal','hp_transfer') OR (e.event->>'kind'='effect_pulse' AND e.event#>>'{meta,healing}'='true')),
  'damage_prevented',COALESCE(sum(
   CASE WHEN jsonb_typeof(e.event#>'{meta,percentMitigated}')='number' THEN (e.event#>>'{meta,percentMitigated}')::numeric ELSE 0 END+
   CASE WHEN jsonb_typeof(e.event#>'{meta,flatMitigated}')='number' THEN (e.event#>>'{meta,flatMitigated}')::numeric ELSE 0 END+
   CASE WHEN jsonb_typeof(e.event#>'{meta,blocked}')='number' THEN (e.event#>>'{meta,blocked}')::numeric ELSE 0 END),0),
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
END; $$;

CREATE OR REPLACE FUNCTION public.combat2_test_run_report(_arena_id uuid,_run_id uuid DEFAULT NULL,_after_seq bigint DEFAULT 0,_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE selected_run public.combat2_test_run; cursor_value bigint:=GREATEST(COALESCE(_after_seq,0),0); page_limit integer:=GREATEST(1,LEAST(COALESCE(_limit,25),50)); latest bigint; through bigint; batches jsonb; summary jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF _run_id IS NULL THEN SELECT * INTO selected_run FROM public.combat2_test_run WHERE arena_id=_arena_id ORDER BY (status='recording') DESC,started_at DESC LIMIT 1;
 ELSE SELECT * INTO selected_run FROM public.combat2_test_run WHERE id=_run_id AND arena_id=_arena_id; END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','unknown_run'); END IF;
 latest:=CASE WHEN selected_run.status='completed' THEN selected_run.final_seq ELSE COALESCE((SELECT max(seq) FROM public.combat2_test_run_batch WHERE run_id=selected_run.id),0) END;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('seq',p.seq,'batchId',p.batch_id,'encounterId',p.encounter_id,'tick',p.tick,'committedAt',p.committed_at,'events',p.events) ORDER BY p.seq),'[]'::jsonb),COALESCE(max(p.seq),cursor_value)
 INTO batches,through FROM (
  SELECT b.*,COALESCE((SELECT jsonb_agg(e.event ORDER BY e.event_seq) FROM public.combat2_test_run_event e WHERE e.run_id=b.run_id AND e.batch_id=b.batch_id),'[]'::jsonb) events
  FROM public.combat2_test_run_batch b WHERE b.run_id=selected_run.id AND b.seq>cursor_value AND b.seq<=latest ORDER BY b.seq LIMIT page_limit
 ) p;
 summary:=COALESCE(selected_run.final_summary,jsonb_build_object('encounter_count',(SELECT count(DISTINCT encounter_id) FROM public.combat2_test_run_batch WHERE run_id=selected_run.id),'batch_count',latest,'event_count',(SELECT count(*) FROM public.combat2_test_run_event WHERE run_id=selected_run.id)));
 RETURN jsonb_build_object('ok',true,'kind','report','run_id',selected_run.id,'status',selected_run.status,'started_at',selected_run.started_at,'completed_at',selected_run.completed_at,
  'duration_ms',CASE WHEN selected_run.completed_at IS NULL THEN NULL ELSE floor(extract(epoch FROM(selected_run.completed_at-selected_run.started_at))*1000)::bigint END,
  'latest_seq',latest,'returned_through_seq',through,'has_more',through<latest,'summary',summary,'batches',batches);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','report_failed');
END; $$;

-- Reset stays destructive and separate, but cannot erase a recording run.
CREATE OR REPLACE FUNCTION public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE prior public.combat2_test_arena_request; result jsonb; staging uuid; encounters integer; restored_characters integer;
 restored_creatures integer; callers uuid:=auth.uid(); failure_stage text:='cleanup'; failure_code text;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_request WHERE request_id=_request_id;
 IF FOUND THEN IF prior.arena_id<>_arena_id OR prior.operation<>'reset' OR prior.caller_id IS DISTINCT FROM callers OR prior.confirm_destroy_diagnostics IS DISTINCT FROM _confirm_destroy_diagnostics THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF; RETURN prior.result; END IF;
 IF NOT _confirm_destroy_diagnostics THEN RETURN jsonb_build_object('ok',false,'kind','confirmation_required'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active) THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_test_run WHERE arena_id=_arena_id AND status='recording') THEN RETURN jsonb_build_object('ok',false,'kind','recording_run_active'); END IF;
 PERFORM 1 FROM public.node_encounter WHERE test_arena_id=_arena_id ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND(status='active' OR claim_token IS NOT NULL)) THEN RETURN jsonb_build_object('ok',false,'kind','arena_not_stopped'); END IF;
 SELECT node_id INTO staging FROM public.combat2_test_arena_node WHERE arena_id=_arena_id AND purpose='staging' AND active;
 IF staging IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','staging_unavailable'); END IF;
 SELECT count(*) INTO encounters FROM public.node_encounter WHERE test_arena_id=_arena_id; failure_stage:='cleanup';
 DELETE FROM public.combat2_tick_notification WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id);
 DELETE FROM public.node_tick_log WHERE encounter_id IN(SELECT id FROM public.node_encounter WHERE test_arena_id=_arena_id);
 DELETE FROM public.combat2_departure_request WHERE origin_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id) OR destination_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id);
 DELETE FROM public.node_reward_claim WHERE creature_id IN(SELECT creature_id FROM public.combat2_test_arena_creature WHERE arena_id=_arena_id);
 DELETE FROM public.node_ground_loot WHERE node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id);
 DELETE FROM public.node_encounter WHERE test_arena_id=_arena_id;
 failure_stage:='tester_restore'; PERFORM set_config('app.combat2_test_relocate_authorized','true',true);
 UPDATE public.characters c SET current_node_id=staging,hp=c.max_hp,cp=c.max_cp,mp=c.max_mp WHERE EXISTS(SELECT 1 FROM public.combat2_test_arena_access x WHERE x.arena_id=_arena_id AND x.character_id=c.id AND x.user_id=c.user_id AND x.active AND x.revoked_at IS NULL); GET DIAGNOSTICS restored_characters=ROW_COUNT;
 failure_stage:='creature_restore'; UPDATE public.creatures c SET hp=r.baseline_hp,is_alive=true,died_at=NULL,last_damaged_at=NULL,is_aggressive=c.base_aggressive,rewards_awarded_at=NULL,spawn_seq=spawn_seq+1 FROM public.combat2_test_arena_creature r WHERE r.arena_id=_arena_id AND r.creature_id=c.id; GET DIAGNOSTICS restored_creatures=ROW_COUNT;
 failure_stage:='request_finalize'; result:=jsonb_build_object('ok',true,'kind','reset','arena_id',_arena_id,'encounters_deleted',encounters,'characters_restored',restored_characters,'creatures_restored',restored_creatures);
 INSERT INTO public.combat2_test_arena_request(request_id,arena_id,operation,caller_id,confirm_destroy_diagnostics,result) VALUES(_request_id,_arena_id,'reset',callers,true,result); RETURN result;
EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE; RETURN jsonb_strip_nulls(jsonb_build_object('ok',false,'kind','reset_failed','stage',CASE WHEN failure_stage IN('cleanup','tester_restore','creature_restore','request_finalize') THEN failure_stage ELSE NULL END,'code',CASE WHEN failure_code~'^[[:alnum:]]{5}$' THEN failure_code ELSE NULL END));
END; $$;

REVOKE ALL ON FUNCTION public.combat2_test_run_start(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.combat2_test_run_stop(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.combat2_test_run_report(uuid,uuid,bigint,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_run_start(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_run_stop(uuid,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_run_report(uuid,uuid,bigint,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) TO authenticated,service_role;
