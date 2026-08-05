CREATE OR REPLACE FUNCTION public.heal_creatures_on_wake()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_healed integer;
BEGIN
  UPDATE public.creatures c
     SET hp = c.max_hp
   WHERE c.is_alive = true
     AND c.hp < c.max_hp
     AND NOT EXISTS (
       SELECT 1 FROM public.encounter_creatures ec
       JOIN public.encounters e ON e.id = ec.encounter_id
       WHERE ec.creature_id = c.id AND e.status = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.combat_sessions s
       WHERE s.node_id = c.node_id AND c.id = ANY(s.engaged_creature_ids)
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.active_effects ae
       WHERE ae.target_id = c.id AND ae.expires_at > v_now_ms
     );
  GET DIAGNOSTICS v_healed = ROW_COUNT;
  RETURN v_healed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.heal_creatures_on_wake() FROM public;
GRANT EXECUTE ON FUNCTION public.heal_creatures_on_wake() TO service_role;

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
  _healed integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  BEGIN ALTER TABLE public.characters ENABLE TRIGGER characters_wake_world; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_auth_emails ENABLE TRIGGER email_queue_wake_auth; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_transactional_emails ENABLE TRIGGER email_queue_wake_transactional; EXCEPTION WHEN OTHERS THEN NULL; END;

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

  -- Wounded creatures do not regen while the world sleeps: top them all off on wake.
  _healed := public.heal_creatures_on_wake();

  UPDATE public.world_state
     SET state = 'awake', changed_at = now(), changed_by = auth.uid()
   WHERE id = 1;

  RETURN jsonb_build_object('state','awake','changed_at', now(), 'creatures_healed', _healed);
END;
$$;

REVOKE ALL ON FUNCTION public.wake_world() FROM public;
GRANT EXECUTE ON FUNCTION public.wake_world() TO authenticated;