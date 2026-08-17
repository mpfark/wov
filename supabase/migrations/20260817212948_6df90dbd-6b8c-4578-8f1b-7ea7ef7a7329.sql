CREATE OR REPLACE FUNCTION public.effects_transport_snapshot(_node_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role', 'supabase_read_only_user') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'dispatch', (
      SELECT jsonb_agg(jsonb_build_object(
        'encounter_id', d.encounter_id, 'node_id', d.node_id, 'dispatch_id', d.dispatch_id,
        'attempt', d.attempt, 'failures', d.failures,
        'request_id', d.request_id, 'request_generation', d.request_generation,
        'requested_at', d.requested_at, 'completed_at', d.completed_at,
        'last_status', d.last_status, 'last_class', d.last_class,
        'last_outcome', d.last_outcome,
        'last_error', public.redact_transport_text(d.last_error),
        'last_transport_error', public.redact_transport_text(d.last_transport_error),
        'lease_until', d.lease_until, 'backoff_until', d.backoff_until))
      FROM public.effects_catchup_dispatch d
      WHERE _node_id IS NULL OR d.node_id = _node_id
    ),
    'responses', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'status_code', r.status_code,
        'error', public.redact_transport_text(r.error_msg),
        'body', public.redact_transport_text(left(COALESCE(r.content, ''), 200)),
        'created', r.created) ORDER BY r.id DESC)
      FROM (SELECT * FROM net._http_response ORDER BY id DESC LIMIT 20) r
    ),
    'queued', (SELECT count(*) FROM net.http_request_queue),
    'now_ms', (extract(epoch from clock_timestamp()) * 1000)::bigint
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.effects_transport_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effects_transport_snapshot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.effects_transport_snapshot(uuid) TO supabase_read_only_user;