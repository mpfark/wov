DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-marketplace-listings') THEN
    PERFORM cron.unschedule('expire-marketplace-listings');
  END IF;
END $$;

SELECT cron.schedule(
  'expire-marketplace-listings',
  '*/5 * * * *',
  $$ SELECT public.expire_marketplace_listings(); $$
);