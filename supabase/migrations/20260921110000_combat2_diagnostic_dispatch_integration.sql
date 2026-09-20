-- Authoritative dispatcher/session bridge for the bounded diagnostic recorder.
-- The original 20260921100000 migration remains unchanged.
CREATE OR REPLACE FUNCTION public.combat2_diagnostic_sessions_for_candidates(_candidates jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service role required'; END IF;
  IF jsonb_typeof(_candidates) IS DISTINCT FROM 'array' OR jsonb_array_length(_candidates)>10 THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('session_id',s.id,'node_id',c.node_id,'encounter_id',c.encounter_id)
      ORDER BY c.node_id,s.started_at,s.id)
    FROM jsonb_to_recordset(_candidates) c(node_id uuid,encounter_id uuid)
    JOIN public.combat2_diagnostic_session s ON s.node_id=c.node_id
      AND (s.encounter_id IS NULL OR s.encounter_id=c.encounter_id)
      AND s.stopped_at IS NULL AND s.expires_at>clock_timestamp()
    JOIN public.characters ch ON ch.id=s.character_id AND ch.current_node_id=c.node_id
    WHERE EXISTS(SELECT 1 FROM public.node_fighter nf WHERE nf.encounter_id=c.encounter_id
      AND nf.character_id=s.character_id AND nf.present)
  ),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.combat2_diagnostic_record_server_events(_session_id uuid,_events jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event jsonb; accepted integer:=0; before_count bigint;
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
    PERFORM public.combat2_diagnostic_record_server_event(_session_id,event->>'event_type',
      NULLIF(event->>'request_id','')::uuid,NULLIF(event->>'intent_id','')::uuid,
      NULLIF(event->>'encounter_id','')::uuid,NULLIF(event->>'node_id','')::uuid,
      NULLIF(event->>'tick','')::bigint,event->>'outcome',NULLIF(event->>'elapsed_ms','')::numeric);
    accepted:=accepted+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'kind',CASE WHEN before_count+accepted>=2000 THEN 'capacity' ELSE 'recorded' END,'accepted',accepted);
EXCEPTION WHEN OTHERS THEN
  -- Diagnostic failure is intentionally contained and never reaches gameplay.
  RETURN jsonb_build_object('ok',false,'kind','diagnostic_failure','accepted',0);
END $$;

REVOKE ALL ON FUNCTION public.combat2_diagnostic_sessions_for_candidates(jsonb),
  public.combat2_diagnostic_record_server_events(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_diagnostic_sessions_for_candidates(jsonb),
  public.combat2_diagnostic_record_server_events(uuid,jsonb) TO service_role;
