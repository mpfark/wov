
-- PAUSE: silence all background activity for cost baseline measurement.
-- Fully reversible via the restore SQL captured in the description.

-- 1. Unschedule all cron jobs
SELECT cron.unschedule('world-watchdog');
SELECT cron.unschedule('expire-timed-state');
SELECT cron.unschedule('prune-logs');
SELECT cron.unschedule('return-unique-items');
-- tick-creatures + process-email-queue are dynamic; unschedule if present
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname IN ('tick-creatures','process-email-queue') LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END$$;

-- 2. Disable triggers that could re-arm cron jobs
ALTER TABLE public.characters DISABLE TRIGGER characters_wake_world;
ALTER TABLE pgmq.q_auth_emails DISABLE TRIGGER email_queue_wake_auth;
ALTER TABLE pgmq.q_transactional_emails DISABLE TRIGGER email_queue_wake_transactional;

-- 3. Drop all tables from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.characters;
ALTER PUBLICATION supabase_realtime DROP TABLE public.creatures;
ALTER PUBLICATION supabase_realtime DROP TABLE public.marketplace_listings;
ALTER PUBLICATION supabase_realtime DROP TABLE public.node_ground_loot;
ALTER PUBLICATION supabase_realtime DROP TABLE public.parties;
ALTER PUBLICATION supabase_realtime DROP TABLE public.party_members;
ALTER PUBLICATION supabase_realtime DROP TABLE public.summon_requests;
