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
 stop_request:=uuid_generate_v5_safe_placeholder();
 RETURN NULL;
END; $$;
