-- ENG-HB-001: durable correlation identity for each actual scheduler-wrapper invocation.
-- This changes observability only. Encounter ticks, settlement buckets, claim tokens,
-- request UUIDs, Edge invocation UUIDs and delivery cursors remain independent.

DO $$
DECLARE
  wrapper_definition text;
  dispatcher_definition text;
  http_body_pattern constant text := '(net[.]http_post[[:space:]]*[(][^;]*)(body[[:space:]]*:=[[:space:]]*''\{\}''::jsonb)([[:space:]]*,[[:space:]]*timeout_milliseconds[[:space:]]*:=)';
  http_body_matches integer;
BEGIN
  IF to_regprocedure('public.combat2_dispatch_scheduler_fire()') IS NULL
     OR to_regprocedure('public.combat2_dispatch_scheduler_fire_without_resource_settlement()') IS NULL
     OR to_regprocedure('public.settle_out_of_combat_resources(timestamptz)') IS NULL
     OR to_regprocedure('public.combat2_diagnostic_record_server_events(uuid,jsonb)') IS NULL
     OR to_regclass('public.combat2_diagnostic_server_event') IS NULL
     OR to_regclass('public.world_heartbeat_run') IS NOT NULL
     OR to_regprocedure('public.combat2_dispatch_scheduler_fire_without_heartbeat_identity()') IS NOT NULL
     OR to_regprocedure('public.combat2_heartbeat_record_dispatch(bigint,text,integer,integer,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'ENG-HB-001 unexpected installation state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.combat2_diagnostic_server_event'::regclass
      AND attname='heartbeat_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'ENG-HB-001 diagnostic heartbeat column already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.combat2_dispatch_scheduler_fire()'::regprocedure
      AND r.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.combat2_dispatch_scheduler_fire_without_resource_settlement()'::regprocedure
      AND r.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public, cron, net, vault, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.settle_out_of_combat_resources(timestamptz)'::regprocedure
      AND r.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public, cron, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    WHERE p.oid='public.combat2_diagnostic_record_server_events(uuid,jsonb)'::regprocedure
      AND r.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND p.proconfig=ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'ENG-HB-001 predecessor owner/security/volatility/search_path drift';
  END IF;

  IF has_function_privilege('anon','public.combat2_dispatch_scheduler_fire()','EXECUTE')
     OR has_function_privilege('authenticated','public.combat2_dispatch_scheduler_fire()','EXECUTE')
     OR has_function_privilege('anon','public.combat2_dispatch_scheduler_fire_without_resource_settlement()','EXECUTE')
     OR has_function_privilege('authenticated','public.combat2_dispatch_scheduler_fire_without_resource_settlement()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.combat2_dispatch_scheduler_fire()','EXECUTE')
     OR NOT has_function_privilege('service_role','public.combat2_dispatch_scheduler_fire_without_resource_settlement()','EXECUTE')
     OR has_function_privilege('anon','public.combat2_diagnostic_record_server_events(uuid,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.combat2_diagnostic_record_server_events(uuid,jsonb)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.combat2_diagnostic_record_server_events(uuid,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'ENG-HB-001 predecessor ACL drift';
  END IF;

  IF (SELECT count(*) FROM pg_attribute
      WHERE attrelid='public.combat2_diagnostic_server_event'::regclass AND NOT attisdropped
        AND ((attname='session_id' AND atttypid='uuid'::regtype)
          OR (attname='sequence' AND atttypid='bigint'::regtype)
          OR (attname='event_type' AND atttypid='text'::regtype)
          OR (attname='request_id' AND atttypid='uuid'::regtype)
          OR (attname='intent_id' AND atttypid='uuid'::regtype)
          OR (attname='encounter_id' AND atttypid='uuid'::regtype)
          OR (attname='node_id' AND atttypid='uuid'::regtype)
          OR (attname='tick' AND atttypid='bigint'::regtype)
          OR (attname='outcome' AND atttypid='text'::regtype)
          OR (attname='elapsed_ms' AND atttypid='numeric'::regtype)))<>10 THEN
    RAISE EXCEPTION 'ENG-HB-001 diagnostic column contract drift';
  END IF;

  wrapper_definition:=pg_get_functiondef('public.combat2_dispatch_scheduler_fire()'::regprocedure);
  dispatcher_definition:=pg_get_functiondef('public.combat2_dispatch_scheduler_fire_without_resource_settlement()'::regprocedure);
  SELECT count(*) INTO http_body_matches FROM regexp_matches(dispatcher_definition,http_body_pattern,'g');
  IF wrapper_definition !~ 'settle_out_of_combat_resources[[:space:]]*[(][[:space:]]*clock_timestamp[[:space:]]*[(][[:space:]]*[)][[:space:]]*[)]'
     OR wrapper_definition !~ 'combat2_dispatch_scheduler_fire_without_resource_settlement[[:space:]]*[(][[:space:]]*[)]'
     OR position('settlement_error' in wrapper_definition)=0
     OR position('scheduler_error' in wrapper_definition)=0
     OR dispatcher_definition !~ 'combat2_dispatch_scheduler_eligible[[:space:]]*[(][[:space:]]*[)]'
     OR http_body_matches<>1 THEN
    RAISE EXCEPTION 'ENG-HB-001 predecessor composition drift';
  END IF;
END $$;

CREATE TABLE public.world_heartbeat_run (
  heartbeat_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  scheduler_eligible boolean NOT NULL,
  scheduler_classification text NOT NULL DEFAULT 'started'
    CHECK (scheduler_classification ~ '^[a-z][a-z0-9_]{0,63}$'),
  settlement_kind text CHECK (settlement_kind IS NULL OR settlement_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  settlement_bucket timestamptz NOT NULL,
  settlement_steps integer CHECK (settlement_steps IS NULL OR settlement_steps BETWEEN 0 AND 3),
  dispatch_classification text CHECK (dispatch_classification IS NULL OR dispatch_classification ~ '^[a-z][a-z0-9_]{0,63}$'),
  candidate_count integer CHECK (candidate_count IS NULL OR candidate_count BETWEEN 0 AND 25),
  processed_count integer CHECK (processed_count IS NULL OR processed_count BETWEEN 0 AND 25),
  more_may_remain boolean,
  dispatch_completed_at timestamptz,
  cleanup_deleted integer NOT NULL DEFAULT 0 CHECK (cleanup_deleted BETWEEN 0 AND 2048),
  cleanup_classification text NOT NULL DEFAULT 'pending'
    CHECK (cleanup_classification IN ('pending','completed','failed')),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (processed_count IS NULL OR candidate_count IS NULL OR processed_count<=candidate_count)
);

CREATE INDEX world_heartbeat_run_started_at_idx
  ON public.world_heartbeat_run(started_at);

ALTER TABLE public.world_heartbeat_run ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.world_heartbeat_run FROM PUBLIC,anon,authenticated;

ALTER TABLE public.combat2_diagnostic_server_event
  ADD COLUMN heartbeat_id bigint;
CREATE INDEX combat2_diagnostic_server_event_heartbeat_idx
  ON public.combat2_diagnostic_server_event(heartbeat_id)
  WHERE heartbeat_id IS NOT NULL;

CREATE FUNCTION public.combat2_diagnostic_record_server_event_with_heartbeat(
  _session_id uuid,_event_type text,_request_id uuid,_intent_id uuid,
  _encounter_id uuid,_node_id uuid,_tick bigint,_outcome text,_elapsed_ms numeric,
  _heartbeat_id bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE next_sequence bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF _heartbeat_id IS NOT NULL AND _heartbeat_id<=0 THEN RAISE EXCEPTION 'invalid heartbeat id'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.combat2_diagnostic_session s WHERE s.id=_session_id
    AND s.stopped_at IS NULL AND s.expires_at>clock_timestamp()) THEN RETURN; END IF;
  SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.combat2_diagnostic_server_event WHERE session_id=_session_id;
  IF next_sequence>2000 THEN RETURN; END IF;
  INSERT INTO public.combat2_diagnostic_server_event(session_id,sequence,event_type,request_id,intent_id,
    encounter_id,node_id,tick,outcome,elapsed_ms,heartbeat_id)
  VALUES(_session_id,next_sequence,_event_type,_request_id,_intent_id,_encounter_id,_node_id,_tick,
    left(_outcome,80),GREATEST(0,_elapsed_ms),_heartbeat_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_diagnostic_record_server_event_with_heartbeat(uuid,text,uuid,uuid,uuid,uuid,bigint,text,numeric,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_diagnostic_record_server_event_with_heartbeat(uuid,text,uuid,uuid,uuid,uuid,bigint,text,numeric,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_diagnostic_record_server_events(_session_id uuid,_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event jsonb; accepted integer:=0; before_count bigint; heartbeat bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF jsonb_typeof(_events) IS DISTINCT FROM 'array' OR jsonb_array_length(_events)>32 THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_batch');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.combat2_diagnostic_session s WHERE s.id=_session_id
    AND s.stopped_at IS NULL AND s.expires_at>clock_timestamp()) THEN
    RETURN jsonb_build_object('ok',true,'kind','inactive','accepted',0);
  END IF;
  SELECT count(*) INTO before_count FROM public.combat2_diagnostic_server_event WHERE session_id=_session_id;
  IF before_count>=2000 THEN RETURN jsonb_build_object('ok',true,'kind','capacity','accepted',0); END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(_events) LOOP
    EXIT WHEN before_count+accepted>=2000;
    heartbeat:=CASE WHEN event->>'heartbeat_id' ~ '^[1-9][0-9]{0,17}$' THEN (event->>'heartbeat_id')::bigint ELSE NULL END;
    PERFORM public.combat2_diagnostic_record_server_event_with_heartbeat(_session_id,event->>'event_type',
      NULLIF(event->>'request_id','')::uuid,NULLIF(event->>'intent_id','')::uuid,
      NULLIF(event->>'encounter_id','')::uuid,NULLIF(event->>'node_id','')::uuid,
      NULLIF(event->>'tick','')::bigint,event->>'outcome',NULLIF(event->>'elapsed_ms','')::numeric,heartbeat);
    accepted:=accepted+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'kind',CASE WHEN before_count+accepted>=2000 THEN 'capacity' ELSE 'recorded' END,'accepted',accepted);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'kind','diagnostic_failure','accepted',0);
END $$;

CREATE FUNCTION public.combat2_heartbeat_record_dispatch(
  _heartbeat_id bigint,_classification text,_candidate_count integer,
  _processed_count integer,_more_may_remain boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF _heartbeat_id<=0 OR _classification !~ '^[a-z][a-z0-9_]{0,63}$'
     OR _candidate_count NOT BETWEEN 0 AND 25 OR _processed_count NOT BETWEEN 0 AND _candidate_count
     OR _more_may_remain IS NULL THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_heartbeat_outcome');
  END IF;
  UPDATE public.world_heartbeat_run
     SET dispatch_classification=_classification,candidate_count=_candidate_count,
         processed_count=_processed_count,more_may_remain=_more_may_remain,
         dispatch_completed_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE heartbeat_id=_heartbeat_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('ok',changed=1,'kind',CASE WHEN changed=1 THEN 'recorded' ELSE 'heartbeat_not_found' END);
END $$;
REVOKE ALL ON FUNCTION public.combat2_heartbeat_record_dispatch(bigint,text,integer,integer,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_heartbeat_record_dispatch(bigint,text,integer,integer,boolean)
  TO service_role;

DO $$
DECLARE
  definition text;
  patched text;
  http_body_pattern constant text := '(net[.]http_post[[:space:]]*[(][^;]*)(body[[:space:]]*:=[[:space:]]*''\{\}''::jsonb)([[:space:]]*,[[:space:]]*timeout_milliseconds[[:space:]]*:=)';
  http_body_matches integer;
BEGIN
  definition:=pg_get_functiondef('public.combat2_dispatch_scheduler_fire_without_resource_settlement()'::regprocedure);
  SELECT count(*) INTO http_body_matches FROM regexp_matches(definition,http_body_pattern,'g');
  IF http_body_matches<>1 THEN
    RAISE EXCEPTION 'ENG-HB-001 dispatcher body patch expected one HTTP body assignment, found %',http_body_matches;
  END IF;
  patched:=regexp_replace(definition,http_body_pattern,
    '\1body := jsonb_build_object(''heartbeat_id'',NULLIF(current_setting(''app.combat2_heartbeat_id'',true),'''')::bigint)\3');
  IF patched=definition OR position('jsonb_build_object(''heartbeat_id''' in patched)=0
     OR patched ~ http_body_pattern THEN
    RAISE EXCEPTION 'ENG-HB-001 dispatcher body patch failed';
  END IF;
  EXECUTE patched;
END $$;

ALTER FUNCTION public.combat2_dispatch_scheduler_fire() RENAME TO combat2_dispatch_scheduler_fire_without_heartbeat_identity;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire_without_heartbeat_identity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_fire_without_heartbeat_identity() TO service_role;

CREATE FUNCTION public.combat2_dispatch_scheduler_fire()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  heartbeat public.world_heartbeat_run%ROWTYPE;
  settlement jsonb;
  dispatch jsonb;
  deleted integer:=0;
BEGIN
  INSERT INTO public.world_heartbeat_run(scheduler_eligible,settlement_bucket)
  VALUES(public.combat2_dispatch_scheduler_eligible(),
    date_bin(interval '4 seconds',clock_timestamp(),timestamptz 'epoch'))
  RETURNING * INTO heartbeat;

  PERFORM set_config('app.combat2_heartbeat_id',heartbeat.heartbeat_id::text,true);

  BEGIN
    DELETE FROM public.world_heartbeat_run WHERE heartbeat_id IN (
      SELECT heartbeat_id FROM public.world_heartbeat_run
      WHERE started_at<clock_timestamp()-interval '24 hours'
      ORDER BY started_at,heartbeat_id LIMIT 2048
    );
    GET DIAGNOSTICS deleted=ROW_COUNT;
    UPDATE public.world_heartbeat_run SET cleanup_deleted=deleted,cleanup_classification='completed',updated_at=clock_timestamp()
      WHERE heartbeat_id=heartbeat.heartbeat_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.world_heartbeat_run SET cleanup_classification='failed',updated_at=clock_timestamp()
      WHERE heartbeat_id=heartbeat.heartbeat_id;
  END;

  BEGIN
    settlement:=public.settle_out_of_combat_resources(heartbeat.started_at);
  EXCEPTION WHEN OTHERS THEN
    settlement:=jsonb_build_object('ok',false,'kind','settlement_error','code',SQLSTATE);
  END;

  BEGIN
    dispatch:=public.combat2_dispatch_scheduler_fire_without_resource_settlement();
  EXCEPTION WHEN OTHERS THEN
    dispatch:=jsonb_build_object('ok',false,'classification','scheduler_error','code',SQLSTATE);
  END;

  UPDATE public.world_heartbeat_run
     SET completed_at=clock_timestamp(),
         scheduler_classification=CASE
           WHEN dispatch->>'classification' ~ '^[a-z][a-z0-9_]{0,63}$' THEN dispatch->>'classification'
           ELSE 'malformed_scheduler_outcome' END,
         settlement_kind=CASE WHEN settlement->>'kind' ~ '^[a-z][a-z0-9_]{0,63}$' THEN settlement->>'kind' ELSE 'malformed_settlement_outcome' END,
         settlement_steps=CASE WHEN settlement->>'steps' ~ '^[0-3]$' THEN (settlement->>'steps')::integer ELSE NULL END,
         updated_at=clock_timestamp()
   WHERE heartbeat_id=heartbeat.heartbeat_id;

  RETURN dispatch || jsonb_build_object(
    'ok',COALESCE((settlement->>'ok')::boolean,false) AND COALESCE((dispatch->>'ok')::boolean,false),
    'heartbeat_id',heartbeat.heartbeat_id,
    'resource_settlement',settlement
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.world_heartbeat_run
     SET completed_at=clock_timestamp(),scheduler_classification='wrapper_error',updated_at=clock_timestamp()
   WHERE heartbeat_id=heartbeat.heartbeat_id;
  RETURN jsonb_build_object('ok',false,'classification','wrapper_error','code',SQLSTATE,'heartbeat_id',heartbeat.heartbeat_id);
END $$;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_fire() TO service_role;