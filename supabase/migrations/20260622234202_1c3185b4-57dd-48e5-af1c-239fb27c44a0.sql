-- A. Trim realtime publication: drop low-churn admin tables
ALTER PUBLICATION supabase_realtime DROP TABLE public.areas;
ALTER PUBLICATION supabase_realtime DROP TABLE public.loot_tables;
ALTER PUBLICATION supabase_realtime DROP TABLE public.loot_table_entries;
ALTER PUBLICATION supabase_realtime DROP TABLE public.weapon_progression_config;
ALTER PUBLICATION supabase_realtime DROP TABLE public.npcs;

-- B. Slow down non-critical cron jobs
SELECT cron.alter_job(job_id := 1, schedule := '*/2 * * * *');   -- respawn_creatures: 1m -> 2m
SELECT cron.alter_job(job_id := 2, schedule := '*/2 * * * *');   -- regen_creature_hp: 1m -> 2m
SELECT cron.alter_job(job_id := 3, schedule := '*/30 * * * *');  -- return_unique_items: 10m -> 30m
SELECT cron.alter_job(job_id := 5, schedule := '*/15 * * * *');  -- expire_marketplace_listings: 5m -> 15m
SELECT cron.alter_job(job_id := 8, schedule := '*/15 * * * *');  -- expire_king_slayer: 5m -> 15m

-- Bump creature regen from 5% to 10% so 2-minute cadence preserves the per-minute rate
CREATE OR REPLACE FUNCTION public.regen_creature_hp()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Runs every 2 minutes; regen ~10% of max_hp per tick (≈5%/min, same as before).
  UPDATE public.creatures
  SET hp = LEAST(hp + GREATEST(CEIL(max_hp * 0.10), 1), max_hp)
  WHERE is_alive = true
    AND hp < max_hp;
END;
$function$;

-- C. Prune cron run history daily (keep last 3 days)
SELECT cron.schedule(
  'prune-cron-history',
  '0 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days';$$
);