SELECT cron.schedule('world-watchdog', '* * * * *', $$SELECT public.world_watchdog();$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'world-watchdog');