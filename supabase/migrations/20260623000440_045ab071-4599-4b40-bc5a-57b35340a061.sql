
-- Drop the activity_log feature entirely
DROP TABLE IF EXISTS public.activity_log CASCADE;
DROP FUNCTION IF EXISTS public.log_activity_batch(jsonb);
DROP FUNCTION IF EXISTS public.log_activity(uuid, uuid, text, text, jsonb);

-- Consolidate creature crons: one job that does both regen + respawn in one txn
CREATE OR REPLACE FUNCTION public.tick_creatures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.regen_creature_hp();
  PERFORM public.respawn_creatures();
END;
$$;

SELECT cron.unschedule('respawn-creatures');
SELECT cron.unschedule('regen-creature-hp');
SELECT cron.schedule('tick-creatures', '*/2 * * * *', $$SELECT public.tick_creatures();$$);
