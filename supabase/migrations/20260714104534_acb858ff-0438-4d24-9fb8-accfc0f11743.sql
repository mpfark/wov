
-- 1. world_state singleton
CREATE TABLE IF NOT EXISTS public.world_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  state text NOT NULL DEFAULT 'asleep' CHECK (state IN ('awake','asleep')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);

GRANT SELECT ON public.world_state TO authenticated, anon;
GRANT ALL    ON public.world_state TO service_role;

ALTER TABLE public.world_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "world_state readable by all" ON public.world_state;
CREATE POLICY "world_state readable by all"
  ON public.world_state FOR SELECT
  USING (true);

INSERT INTO public.world_state (id, state) VALUES (1, 'asleep')
ON CONFLICT (id) DO NOTHING;

-- 2. shutdown_world(): mirror the manual pause
CREATE OR REPLACE FUNCTION public.shutdown_world()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  _job record;
  _tbl text;
  _realtime_tables text[] := ARRAY[
    'characters','creatures','marketplace_listings',
    'node_ground_loot','parties','party_members','summon_requests'
  ];
BEGIN
  -- Unschedule every cron job we own
  FOR _job IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'world-watchdog','expire-timed-state','prune-logs','return-unique-items',
      'tick-creatures','process-email-queue','idle-shutdown-check'
    )
  LOOP
    BEGIN PERFORM cron.unschedule(_job.jobname); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  -- Disable wake triggers
  BEGIN ALTER TABLE public.characters DISABLE TRIGGER characters_wake_world; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_auth_emails DISABLE TRIGGER email_queue_wake_auth; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_transactional_emails DISABLE TRIGGER email_queue_wake_transactional; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Drop tables from realtime publication
  FOREACH _tbl IN ARRAY _realtime_tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', _tbl);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  UPDATE public.world_state
     SET state = 'asleep', changed_at = now(), changed_by = NULL
   WHERE id = 1;
END;
$$;

-- 3. idle_shutdown_check(): shuts down if nobody online in 30 minutes
CREATE OR REPLACE FUNCTION public.idle_shutdown_check()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.characters WHERE last_online > now() - interval '30 minutes'
  ) THEN
    PERFORM public.shutdown_world();
  END IF;
END;
$$;

-- 4. wake_world(): re-arm everything
CREATE OR REPLACE FUNCTION public.wake_world()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  _tbl text;
  _realtime_tables text[] := ARRAY[
    'characters','creatures','marketplace_listings',
    'node_ground_loot','parties','party_members','summon_requests'
  ];
  _already_in_pub boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Re-enable wake triggers
  BEGIN ALTER TABLE public.characters ENABLE TRIGGER characters_wake_world; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_auth_emails ENABLE TRIGGER email_queue_wake_auth; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_transactional_emails ENABLE TRIGGER email_queue_wake_transactional; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Re-add realtime tables (skip if already present)
  FOREACH _tbl IN ARRAY _realtime_tables LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=_tbl
    ) INTO _already_in_pub;
    IF NOT _already_in_pub THEN
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', _tbl);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;

  -- Re-schedule core crons
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='world-watchdog') THEN
    PERFORM cron.schedule('world-watchdog', '*/5 * * * *', $c$SELECT public.world_watchdog();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='expire-timed-state') THEN
    PERFORM cron.schedule('expire-timed-state', '*/15 * * * *', $c$SELECT public.guarded_expire_timed_state();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune-logs') THEN
    PERFORM cron.schedule('prune-logs', '0 * * * *', $c$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='return-unique-items') THEN
    PERFORM cron.schedule('return-unique-items', '0 * * * *', $c$SELECT public.guarded_return_unique_items();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='idle-shutdown-check') THEN
    PERFORM cron.schedule('idle-shutdown-check', '*/30 * * * *', $c$SELECT public.idle_shutdown_check();$c$);
  END IF;

  UPDATE public.world_state
     SET state = 'awake', changed_at = now(), changed_by = auth.uid()
   WHERE id = 1;

  RETURN jsonb_build_object('state','awake','changed_at', now());
END;
$$;

-- Grants
REVOKE ALL ON FUNCTION public.wake_world()            FROM public;
REVOKE ALL ON FUNCTION public.shutdown_world()        FROM public;
REVOKE ALL ON FUNCTION public.idle_shutdown_check()   FROM public;
GRANT EXECUTE ON FUNCTION public.wake_world()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.shutdown_world()      TO service_role;
GRANT EXECUTE ON FUNCTION public.idle_shutdown_check() TO service_role;
