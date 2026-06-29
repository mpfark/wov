-- 1. Slow email cron from 5s to 1 min (event-driven flush remains)
SELECT cron.unschedule(17);
SELECT cron.schedule(
  'process-email-queue',
  '* * * * *',
  $cron$
  SELECT CASE
    WHEN (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now()
      THEN NULL
    WHEN EXISTS (SELECT 1 FROM pgmq.q_auth_emails LIMIT 1)
      OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails LIMIT 1)
      THEN net.http_post(
        url := 'https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/process-email-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Lovable-Context', 'cron',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := '{}'::jsonb
      )
    ELSE NULL
  END;
  $cron$
);

-- 2. Drop character_materials from realtime publication (on-demand fetch only)
ALTER PUBLICATION supabase_realtime DROP TABLE public.character_materials;

-- 3. Add cheap EXISTS pre-checks to creature tick helpers
CREATE OR REPLACE FUNCTION public.regen_creature_hp()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.creatures WHERE is_alive = true AND hp < max_hp
  ) THEN
    RETURN;
  END IF;
  UPDATE public.creatures
  SET hp = LEAST(hp + GREATEST(CEIL(max_hp * 0.10), 1), max_hp)
  WHERE is_alive = true
    AND hp < max_hp;
END;
$$;

CREATE OR REPLACE FUNCTION public.respawn_creatures()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.creatures
    WHERE is_alive = false
      AND died_at IS NOT NULL
      AND died_at + (respawn_seconds || ' seconds')::interval <= now()
  ) THEN
    RETURN;
  END IF;
  UPDATE public.creatures
  SET is_alive = true,
      hp = max_hp,
      died_at = NULL,
      is_aggressive = base_aggressive,
      rewards_awarded_at = NULL
  WHERE is_alive = false
    AND died_at IS NOT NULL
    AND died_at + (respawn_seconds || ' seconds')::interval <= now();
END;
$$;