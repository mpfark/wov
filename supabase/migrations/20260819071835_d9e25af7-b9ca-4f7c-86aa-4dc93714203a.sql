SELECT cron.schedule(
  'idle-shutdown-check',
  '*/30 * * * *',
  $$SELECT public.idle_shutdown_check();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'idle-shutdown-check'
);