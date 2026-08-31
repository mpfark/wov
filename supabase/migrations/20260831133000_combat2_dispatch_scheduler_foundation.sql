-- Disabled-by-default Combat2 dispatcher scheduling foundation.
-- Applying this migration defines controls only; it never creates a cron job.

CREATE TABLE IF NOT EXISTS public.combat2_dispatch_schedule_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  request_id bigint,
  requested_at timestamptz
);

INSERT INTO public.combat2_dispatch_schedule_state (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE public.combat2_dispatch_schedule_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.combat2_dispatch_scheduler_eligible()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.world_state_is_awake() AND public.combat_mode_is_open();
$function$;

CREATE OR REPLACE FUNCTION public.combat2_dispatch_scheduler_disable()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_job record;
  v_removed integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('combat2-dispatch-once-schedule'));

  FOR v_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'combat2-dispatch-once'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
    v_removed := v_removed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'classification', 'disabled', 'removed', v_removed);
END;
$function$;

CREATE OR REPLACE FUNCTION public.combat2_dispatch_scheduler_fire()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'net', 'vault'
AS $function$
DECLARE
  v_state public.combat2_dispatch_schedule_state%ROWTYPE;
  v_secret text;
  v_request_id bigint;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('combat2-dispatch-once-fire')) THEN
    RETURN jsonb_build_object('ok', false, 'classification', 'overlap_refused');
  END IF;

  IF NOT public.combat2_dispatch_scheduler_eligible() THEN
    PERFORM public.combat2_dispatch_scheduler_disable();
    RETURN jsonb_build_object('ok', false, 'classification', 'ineligible');
  END IF;

  SELECT * INTO v_state
    FROM public.combat2_dispatch_schedule_state
   WHERE singleton = true
   FOR UPDATE;

  IF v_state.request_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM net._http_response WHERE id = v_state.request_id) THEN
      DELETE FROM net._http_response WHERE id = v_state.request_id;
      UPDATE public.combat2_dispatch_schedule_state
         SET request_id = NULL, requested_at = NULL
       WHERE singleton = true;
    ELSIF v_state.requested_at > clock_timestamp() - interval '15 seconds' THEN
      RETURN jsonb_build_object('ok', false, 'classification', 'overlap_refused');
    ELSE
      UPDATE public.combat2_dispatch_schedule_state
         SET request_id = NULL, requested_at = NULL
       WHERE singleton = true;
    END IF;
  END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'COMBAT2_WORKER_SECRET';

  IF v_secret IS NULL OR v_secret = '' THEN
    PERFORM public.combat2_dispatch_scheduler_disable();
    RETURN jsonb_build_object('ok', false, 'classification', 'secret_unavailable');
  END IF;

  SELECT net.http_post(
    url := 'https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/combat2-dispatch-once',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 12000
  ) INTO v_request_id;

  UPDATE public.combat2_dispatch_schedule_state
     SET request_id = v_request_id, requested_at = clock_timestamp()
   WHERE singleton = true;

  RETURN jsonb_build_object('ok', true, 'classification', 'queued');
END;
$function$;

CREATE OR REPLACE FUNCTION public.combat2_dispatch_scheduler_enable()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron', 'vault'
AS $function$
DECLARE
  v_count integer;
  v_exact integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('combat2-dispatch-once-schedule'));

  IF NOT public.combat2_dispatch_scheduler_eligible() THEN
    PERFORM public.combat2_dispatch_scheduler_disable();
    RETURN jsonb_build_object('ok', false, 'classification', 'ineligible');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'COMBAT2_WORKER_SECRET'
  ) THEN
    PERFORM public.combat2_dispatch_scheduler_disable();
    RETURN jsonb_build_object('ok', false, 'classification', 'secret_unavailable');
  END IF;

  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'combat2-dispatch-once';

  SELECT count(*) INTO v_exact
    FROM cron.job
   WHERE jobname = 'combat2-dispatch-once'
     AND schedule = '2 seconds'
     AND command = 'SELECT public.combat2_dispatch_scheduler_fire();';

  IF v_count = 1 AND v_exact = 1 THEN
    RETURN jsonb_build_object('ok', true, 'classification', 'already_enabled');
  END IF;

  PERFORM public.combat2_dispatch_scheduler_disable();
  PERFORM cron.schedule(
    'combat2-dispatch-once',
    '2 seconds',
    $cron$SELECT public.combat2_dispatch_scheduler_fire();$cron$
  );

  RETURN jsonb_build_object('ok', true, 'classification', 'enabled');
END;
$function$;

REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_eligible() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_enable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_disable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.combat2_dispatch_scheduler_fire() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_eligible() TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_disable() TO service_role;
GRANT EXECUTE ON FUNCTION public.combat2_dispatch_scheduler_fire() TO service_role;
