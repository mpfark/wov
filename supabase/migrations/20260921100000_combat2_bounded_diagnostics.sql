-- Opt-in, bounded Combat2 diagnostics. This is observational only: no gameplay
-- table, cadence, claim lease or resolver contract is changed.
CREATE TABLE public.combat2_diagnostic_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  node_id uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
  encounter_id uuid REFERENCES public.node_encounter(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  stopped_at timestamptz,
  CONSTRAINT combat2_diagnostic_duration CHECK (expires_at <= started_at + interval '5 minutes')
);

CREATE TABLE public.combat2_diagnostic_server_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.combat2_diagnostic_session(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL CHECK (event_type IN (
    'rpc_received','intent_accepted','intent_refused','tick_due','dispatcher_requested',
    'claim_attempted','claim_refused','claim_acquired','decode_completed','resolve_completed',
    'commit_attempted','commit_completed','commit_refused','notification_persisted')),
  request_id uuid, intent_id uuid, encounter_id uuid, node_id uuid,
  tick bigint, outcome text, elapsed_ms numeric,
  UNIQUE(session_id, sequence)
);

ALTER TABLE public.combat2_diagnostic_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_diagnostic_server_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_diagnostic_session, public.combat2_diagnostic_server_event FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.combat2_diagnostic_session, public.combat2_diagnostic_server_event TO service_role;

CREATE OR REPLACE FUNCTION public.combat2_diagnostic_start(
  _character_id uuid, _node_id uuid, _encounter_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); created public.combat2_diagnostic_session;
BEGIN
  IF caller IS NULL OR NOT public.is_steward_or_overlord() THEN
    RETURN jsonb_build_object('ok',false,'kind','not_authorized');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_scope');
  END IF;
  UPDATE public.combat2_diagnostic_session SET stopped_at=clock_timestamp()
   WHERE actor_id=caller AND stopped_at IS NULL AND expires_at>clock_timestamp();
  INSERT INTO public.combat2_diagnostic_session(actor_id,character_id,node_id,encounter_id,expires_at)
  VALUES(caller,_character_id,_node_id,_encounter_id,clock_timestamp()+interval '5 minutes') RETURNING * INTO created;
  RETURN jsonb_build_object('ok',true,'kind','started','session_id',created.id,
    'started_at',created.started_at,'expires_at',created.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.combat2_diagnostic_stop(_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); changed integer;
BEGIN
  IF caller IS NULL OR NOT public.is_steward_or_overlord() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
  UPDATE public.combat2_diagnostic_session SET stopped_at=COALESCE(stopped_at,clock_timestamp())
   WHERE id=_session_id AND actor_id=caller; GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN jsonb_build_object('ok',changed=1,'kind',CASE WHEN changed=1 THEN 'stopped' ELSE 'not_found' END);
END $$;

CREATE OR REPLACE FUNCTION public.combat2_diagnostic_record_server_event(
  _session_id uuid,_event_type text,_request_id uuid DEFAULT NULL,_intent_id uuid DEFAULT NULL,
  _encounter_id uuid DEFAULT NULL,_node_id uuid DEFAULT NULL,_tick bigint DEFAULT NULL,
  _outcome text DEFAULT NULL,_elapsed_ms numeric DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE next_sequence bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.combat2_diagnostic_session s WHERE s.id=_session_id
    AND s.stopped_at IS NULL AND s.expires_at>clock_timestamp()) THEN RETURN; END IF;
  SELECT COALESCE(max(sequence),0)+1 INTO next_sequence FROM public.combat2_diagnostic_server_event WHERE session_id=_session_id;
  IF next_sequence>2000 THEN RETURN; END IF;
  INSERT INTO public.combat2_diagnostic_server_event(session_id,sequence,event_type,request_id,intent_id,
    encounter_id,node_id,tick,outcome,elapsed_ms) VALUES(_session_id,next_sequence,_event_type,_request_id,_intent_id,
    _encounter_id,_node_id,_tick,left(_outcome,80),GREATEST(0,_elapsed_ms));
END $$;

CREATE OR REPLACE FUNCTION public.combat2_diagnostic_export(_session_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); result jsonb;
BEGIN
  IF caller IS NULL OR NOT public.is_steward_or_overlord() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
  SELECT jsonb_build_object('ok',true,'kind','exported','session',jsonb_build_object(
    'session_id',s.id,'character_id',s.character_id,'node_id',s.node_id,'encounter_id',s.encounter_id,
    'started_at',s.started_at,'expires_at',s.expires_at,'stopped_at',s.stopped_at),
    'events',COALESCE((SELECT jsonb_agg(to_jsonb(e)-'id' ORDER BY e.sequence)
      FROM (SELECT * FROM public.combat2_diagnostic_server_event WHERE session_id=s.id ORDER BY sequence LIMIT 2000)e),'[]'::jsonb))
  INTO result FROM public.combat2_diagnostic_session s WHERE s.id=_session_id AND s.actor_id=caller;
  RETURN COALESCE(result,jsonb_build_object('ok',false,'kind','not_found'));
END $$;

REVOKE ALL ON FUNCTION public.combat2_diagnostic_start(uuid,uuid,uuid), public.combat2_diagnostic_stop(uuid),
  public.combat2_diagnostic_export(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_diagnostic_start(uuid,uuid,uuid), public.combat2_diagnostic_stop(uuid),
  public.combat2_diagnostic_export(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.combat2_diagnostic_record_server_event(uuid,text,uuid,uuid,uuid,uuid,bigint,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_diagnostic_record_server_event(uuid,text,uuid,uuid,uuid,uuid,bigint,text,numeric) TO service_role;

-- Server retention is bounded independently from the five-minute capture window.
DELETE FROM public.combat2_diagnostic_session WHERE started_at < clock_timestamp()-interval '24 hours';
