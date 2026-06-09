
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-king-slayer') THEN
    PERFORM cron.unschedule('expire-king-slayer');
  END IF;
END $$;

SELECT cron.schedule(
  'expire-king-slayer',
  '*/5 * * * *',
  $$ SELECT public.expire_king_slayer(); $$
);
