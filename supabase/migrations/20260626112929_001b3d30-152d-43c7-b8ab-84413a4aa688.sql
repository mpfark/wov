
-- 1. Reclaim ~4.4 GB by truncating bloated log tables
TRUNCATE TABLE cron.job_run_details;
TRUNCATE TABLE net._http_response;

-- 2. Helper that prunes both tables on a small, fast window
CREATE OR REPLACE FUNCTION public.prune_cron_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '1 day';
  DELETE FROM net._http_response   WHERE created  < now() - interval '1 hour';
END;
$$;

-- 3. Replace the broken daily prune with an hourly one
DO $$
DECLARE _jid bigint;
BEGIN
  SELECT jobid INTO _jid FROM cron.job WHERE jobname = 'prune-logs';
  IF _jid IS NOT NULL THEN PERFORM cron.unschedule(_jid); END IF;
END $$;

SELECT cron.unschedule(9);

SELECT cron.schedule(
  'prune-logs',
  '0 * * * *',
  $$SELECT public.prune_cron_history();$$
);
