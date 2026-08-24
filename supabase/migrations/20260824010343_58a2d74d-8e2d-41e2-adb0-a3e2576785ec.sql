-- ─────────────────────────────────────────────────────────────
-- Sleep-aware background maintenance
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.world_state_is_awake()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT ws.state = 'awake' FROM public.world_state ws WHERE ws.id = 1), false);
$$;

REVOKE ALL ON FUNCTION public.world_state_is_awake() FROM public;
GRANT EXECUTE ON FUNCTION public.world_state_is_awake() TO service_role;

-- Guarded wrappers: cron calls these, the underlying functions keep their
-- signatures so direct/admin calls are unaffected.

CREATE OR REPLACE FUNCTION public.guarded_prune_encounter_tick_batches()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.prune_encounter_tick_batches(180, 2000);
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_prune_encounter_access_grants()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.prune_encounter_access_grants(2000);
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_cleanup_ground_loot()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.cleanup_ground_loot();
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_sweep_stranded_encounters()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.sweep_stranded_encounters(300, 200);
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_prune_effects_catchup_log()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.prune_effects_catchup_log(2000);
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_prune_terminal_combat_actions()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.prune_terminal_combat_actions(3600, 2000);
END;
$$;

CREATE OR REPLACE FUNCTION public.guarded_prune_combat_audit_log()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.world_state_is_awake() THEN RETURN; END IF;
  PERFORM public.prune_combat_audit_log();
END;
$$;

DO $do$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'guarded_prune_encounter_tick_batches','guarded_prune_encounter_access_grants',
    'guarded_cleanup_ground_loot','guarded_sweep_stranded_encounters',
    'guarded_prune_effects_catchup_log','guarded_prune_terminal_combat_actions',
    'guarded_prune_combat_audit_log'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM public', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO service_role', fn);
  END LOOP;
END
$do$;

-- One final maintenance pass, used by shutdown_world() so nothing is left
-- stranded for the duration of the sleep.
CREATE OR REPLACE FUNCTION public.final_maintenance_sweep()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  BEGIN PERFORM public.sweep_stranded_encounters(300, 200);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: sweep_stranded_encounters failed: %', SQLERRM; END;
  BEGIN PERFORM public.cleanup_ground_loot();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: cleanup_ground_loot failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_encounter_access_grants(2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_encounter_access_grants failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_encounter_tick_batches(180, 2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_encounter_tick_batches failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_terminal_combat_actions(3600, 2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_terminal_combat_actions failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_effects_catchup_log(2000);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_effects_catchup_log failed: %', SQLERRM; END;
  BEGIN PERFORM public.prune_combat_audit_log();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep: prune_combat_audit_log failed: %', SQLERRM; END;
END;
$$;

REVOKE ALL ON FUNCTION public.final_maintenance_sweep() FROM public;
GRANT EXECUTE ON FUNCTION public.final_maintenance_sweep() TO service_role;

-- ── shutdown_world(): final sweep + unschedule the maintenance jobs too ──
CREATE OR REPLACE FUNCTION public.shutdown_world()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  _job record;
  _tbl text;
  _realtime_tables text[] := ARRAY[
    'characters','creatures','marketplace_listings',
    'node_ground_loot','parties','party_members','summon_requests'
  ];
BEGIN
  -- Leave nothing stranded for the duration of the sleep.
  BEGIN PERFORM public.final_maintenance_sweep();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final_maintenance_sweep() failed during shutdown: %', SQLERRM; END;

  FOR _job IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'world-watchdog','expire-timed-state','prune-logs','return-unique-items',
      'tick-creatures','process-email-queue','idle-shutdown-check','effects-catchup',
      -- sleep-aware maintenance jobs
      'prune-combat-audit','prune-encounter-tick-batches','prune-encounter-access-grants',
      'purge-ground-loot','prune-effects-catchup-log','sweep-stranded-encounters',
      'prune-terminal-combat-actions'
    )
  LOOP
    BEGIN PERFORM cron.unschedule(_job.jobname); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  BEGIN ALTER TABLE public.characters DISABLE TRIGGER characters_wake_world; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_auth_emails DISABLE TRIGGER email_queue_wake_auth; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER TABLE pgmq.q_transactional_emails DISABLE TRIGGER email_queue_wake_transactional; EXCEPTION WHEN OTHERS THEN NULL; END;

  FOREACH _tbl IN ARRAY _realtime_tables LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', _tbl);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  PERFORM public.sim_note_suspend();

  UPDATE public.world_state
     SET state = 'asleep', changed_at = now(), changed_by = NULL
   WHERE id = 1;
END;
$function$;

-- ── wake_world(): restore the maintenance jobs on wake ──
CREATE OR REPLACE FUNCTION public.wake_world()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  _tbl text;
  _realtime_tables text[] := ARRAY[
    'characters','creatures','marketplace_listings',
    'node_ground_loot','parties','party_members','summon_requests'
  ];
  _already_in_pub boolean;
  _healed integer := 0;
  _pending boolean;
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

  -- Sleep-aware maintenance jobs (guarded bodies, restored only while awake).
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune-encounter-tick-batches') THEN
    PERFORM cron.schedule('prune-encounter-tick-batches', '*/5 * * * *', $c$SELECT public.guarded_prune_encounter_tick_batches();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune-encounter-access-grants') THEN
    PERFORM cron.schedule('prune-encounter-access-grants', '*/5 * * * *', $c$SELECT public.guarded_prune_encounter_access_grants();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='purge-ground-loot') THEN
    PERFORM cron.schedule('purge-ground-loot', '*/5 * * * *', $c$SELECT public.guarded_cleanup_ground_loot();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='sweep-stranded-encounters') THEN
    PERFORM cron.schedule('sweep-stranded-encounters', '*/5 * * * *', $c$SELECT public.guarded_sweep_stranded_encounters();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune-effects-catchup-log') THEN
    PERFORM cron.schedule('prune-effects-catchup-log', '23 * * * *', $c$SELECT public.guarded_prune_effects_catchup_log();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune-terminal-combat-actions') THEN
    PERFORM cron.schedule('prune-terminal-combat-actions', '37 * * * *', $c$SELECT public.guarded_prune_terminal_combat_actions();$c$);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='prune-combat-audit') THEN
    PERFORM cron.schedule('prune-combat-audit', '17 * * * *', $c$SELECT public.guarded_prune_combat_audit_log();$c$);
  END IF;

  PERFORM public.schedule_tick_creatures();

  _healed := public.heal_creatures_on_wake();

  PERFORM public.sim_note_resume();

  SELECT EXISTS (SELECT 1 FROM public.effects_due_scopes(1, NULL)) INTO _pending;
  IF _pending THEN
    PERFORM public.schedule_effects_catchup();
  END IF;

  UPDATE public.world_state
     SET state = 'awake', changed_at = now(), changed_by = auth.uid()
   WHERE id = 1;

  RETURN jsonb_build_object('state','awake','changed_at', now(), 'creatures_healed', _healed);
END;
$function$;

-- ── Stop the currently running jobs now (world is already asleep) ──
DO $do$
DECLARE _job record;
BEGIN
  IF NOT public.world_state_is_awake() THEN
    BEGIN PERFORM public.final_maintenance_sweep();
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'final sweep failed: %', SQLERRM; END;

    FOR _job IN
      SELECT jobname FROM cron.job
      WHERE jobname IN (
        'prune-combat-audit','prune-encounter-tick-batches','prune-encounter-access-grants',
        'purge-ground-loot','prune-effects-catchup-log','sweep-stranded-encounters',
        'prune-terminal-combat-actions'
      )
    LOOP
      BEGIN PERFORM cron.unschedule(_job.jobname); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  ELSE
    -- Awake: just repoint the existing jobs at the guarded bodies / new cadence.
    BEGIN PERFORM cron.schedule('prune-encounter-tick-batches', '*/5 * * * *', $c$SELECT public.guarded_prune_encounter_tick_batches();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.schedule('prune-encounter-access-grants', '*/5 * * * *', $c$SELECT public.guarded_prune_encounter_access_grants();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.schedule('purge-ground-loot', '*/5 * * * *', $c$SELECT public.guarded_cleanup_ground_loot();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.schedule('sweep-stranded-encounters', '*/5 * * * *', $c$SELECT public.guarded_sweep_stranded_encounters();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.schedule('prune-effects-catchup-log', '23 * * * *', $c$SELECT public.guarded_prune_effects_catchup_log();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.schedule('prune-terminal-combat-actions', '37 * * * *', $c$SELECT public.guarded_prune_terminal_combat_actions();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.schedule('prune-combat-audit', '17 * * * *', $c$SELECT public.guarded_prune_combat_audit_log();$c$); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
END
$do$;