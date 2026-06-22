-- 1. Index for character_visited_nodes lookups by character_id
CREATE INDEX IF NOT EXISTS idx_cvn_character_id
  ON public.character_visited_nodes (character_id);

-- 2. Reschedule the email queue poller from 5s -> 30s.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'process-email-queue';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '30 seconds');
  END IF;
END $$;
