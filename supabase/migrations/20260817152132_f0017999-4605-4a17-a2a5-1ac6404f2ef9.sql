-- ─────────────────────────────────────────────────────────────────────────────
-- Stage 3 + 4: durable dispatch, self-arming scheduling, pause boundary.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Authoritative simulation pause boundary (policy C). No effect mutation.
CREATE TABLE IF NOT EXISTS public.simulation_pause_state (
  id integer PRIMARY KEY DEFAULT 1,
  last_sim_at_ms bigint,
  suspended_at_ms bigint,
  resumed_at_ms bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT simulation_pause_state_singleton CHECK (id = 1)
);
INSERT INTO public.simulation_pause_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
GRANT ALL ON public.simulation_pause_state TO service_role;
ALTER TABLE public.simulation_pause_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pause state is service-role only" ON public.simulation_pause_state;
CREATE POLICY "pause state is service-role only"
  ON public.simulation_pause_state FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.sim_note_progress()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE public.simulation_pause_state
     SET last_sim_at_ms = (extract(epoch from clock_timestamp()) * 1000)::bigint,
         updated_at = now()
   WHERE id = 1;
$function$;

CREATE OR REPLACE FUNCTION public.sim_note_suspend()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE public.simulation_pause_state
     SET suspended_at_ms = COALESCE(suspended_at_ms, last_sim_at_ms,
                                    (extract(epoch from clock_timestamp()) * 1000)::bigint),
         updated_at = now()
   WHERE id = 1;
$function$;

CREATE OR REPLACE FUNCTION public.sim_note_resume()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE public.simulation_pause_state
     SET resumed_at_ms = (extract(epoch from clock_timestamp()) * 1000)::bigint,
         last_sim_at_ms = (extract(epoch from clock_timestamp()) * 1000)::bigint,
         updated_at = now()
   WHERE id = 1;
$function$;

-- Boundary handed to effects-only resolution. A pause exists only when the
-- scheduler was actually suspended and later resumed.
CREATE OR REPLACE FUNCTION public.simulation_pause_boundary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN s.suspended_at_ms IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'suspendedAtMs', s.suspended_at_ms,
      'resumedAtMs', COALESCE(s.resumed_at_ms, (extract(epoch from clock_timestamp()) * 1000)::bigint)
    )
  END
  FROM public.simulation_pause_state s WHERE s.id = 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.sim_note_progress() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sim_note_suspend() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sim_note_resume() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.simulation_pause_boundary() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sim_note_progress() TO service_role;
GRANT EXECUTE ON FUNCTION public.sim_note_suspend() TO service_role;
GRANT EXECUTE ON FUNCTION public.sim_note_resume() TO service_role;
GRANT EXECUTE ON FUNCTION public.simulation_pause_boundary() TO service_role;

-- 2. Durable dispatch ownership.
CREATE TABLE IF NOT EXISTS public.effects_catchup_dispatch (
  encounter_id uuid PRIMARY KEY,
  node_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  due_at_ms bigint NOT NULL,
  lease_until bigint NOT NULL DEFAULT 0,
  backoff_until bigint NOT NULL DEFAULT 0,
  last_outcome text,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.effects_catchup_dispatch TO service_role;
ALTER TABLE public.effects_catchup_dispatch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dispatch is service-role only" ON public.effects_catchup_dispatch;
CREATE POLICY "dispatch is service-role only"
  ON public.effects_catchup_dispatch FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.effects_catchup_log (
  id bigserial PRIMARY KEY,
  dispatch_id uuid,
  encounter_id uuid,
  node_id uuid,
  phase text NOT NULL,
  outcome text,
  reason text,
  ticks integer,
  effects integer,
  deaths integer,
  duration_ms integer,
  due_age_ms bigint,
  scopes_discovered integer,
  scopes_claimed integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS effects_catchup_log_created_idx ON public.effects_catchup_log (created_at DESC);
GRANT ALL ON public.effects_catchup_log TO service_role;
ALTER TABLE public.effects_catchup_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catchup log is service-role only" ON public.effects_catchup_log;
CREATE POLICY "catchup log is service-role only"
  ON public.effects_catchup_log FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.prune_effects_catchup_log(_keep integer DEFAULT 2000)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_deleted integer;
BEGIN
  WITH doomed AS (
    SELECT id FROM public.effects_catchup_log
    ORDER BY id DESC OFFSET GREATEST(100, COALESCE(_keep, 2000))
  ), del AS (
    DELETE FROM public.effects_catchup_log l USING doomed d WHERE l.id = d.id RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.prune_effects_catchup_log(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_effects_catchup_log(integer) TO service_role;

-- 3. Result recorder: identity-checked, lease-releasing, backoff-preserving.
CREATE OR REPLACE FUNCTION public.record_effects_catchup_result(
  _dispatch_id uuid,
  _encounter_id uuid,
  _outcome text,
  _reason text DEFAULT NULL,
  _ticks integer DEFAULT 0,
  _effects integer DEFAULT 0,
  _deaths integer DEFAULT 0,
  _duration_ms integer DEFAULT NULL
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  d public.effects_catchup_dispatch;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_failure boolean;
BEGIN
  SELECT * INTO d FROM public.effects_catchup_dispatch
   WHERE encounter_id = _encounter_id FOR UPDATE;

  IF d.encounter_id IS NULL OR d.dispatch_id IS DISTINCT FROM _dispatch_id THEN
    -- A late callback from a superseded dispatch must never clear a newer lease.
    INSERT INTO public.effects_catchup_log
      (dispatch_id, encounter_id, phase, outcome, reason, ticks, effects, deaths, duration_ms)
    VALUES (_dispatch_id, _encounter_id, 'result', 'stale_callback', _outcome,
            _ticks, _effects, _deaths, _duration_ms);
    RETURN 'stale_callback';
  END IF;

  v_failure := _outcome IN ('internal', 'commit_refused', 'lease_lost', 'transport_error',
                            'resolver_failed', 'config_conflict');

  UPDATE public.effects_catchup_dispatch
     SET lease_until = 0,                       -- released the moment the request completed
         last_outcome = _outcome,
         last_error = _reason,
         failures = CASE WHEN v_failure THEN failures + 1 ELSE 0 END,
         backoff_until = CASE
           WHEN v_failure AND failures + 1 >= 5 THEN v_now + 30000
           ELSE 0
         END,
         updated_at = now()
   WHERE encounter_id = _encounter_id;

  INSERT INTO public.effects_catchup_log
    (dispatch_id, encounter_id, node_id, phase, outcome, reason, ticks, effects, deaths,
     duration_ms, due_age_ms)
  VALUES (_dispatch_id, _encounter_id, d.node_id, 'result', _outcome, _reason,
          _ticks, _effects, _deaths, _duration_ms, GREATEST(0, v_now - d.due_at_ms));

  RETURN 'recorded';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.record_effects_catchup_result(uuid, uuid, text, text, integer, integer, integer, integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_effects_catchup_result(uuid, uuid, text, text, integer, integer, integer, integer)
  TO service_role;

-- 4. Scheduling helpers (idempotent; 2-second interval form of pg_cron 1.6).
CREATE OR REPLACE FUNCTION public.schedule_effects_catchup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'effects-catchup') THEN
    PERFORM cron.schedule('effects-catchup', '2 seconds', $c$SELECT public.effects_due_dispatch();$c$);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedule_effects_catchup failed: %', SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public.unschedule_effects_catchup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'effects-catchup') THEN
    PERFORM cron.unschedule('effects-catchup');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'unschedule_effects_catchup failed: %', SQLERRM;
END;
$function$;

-- Arming hook usable from presence transitions: arm only when there is pending
-- effects-only work and no healthy live owner.
CREATE OR REPLACE FUNCTION public.arm_effects_catchup_for_node(_node_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
DECLARE v_enc uuid;
BEGIN
  IF _node_id IS NULL THEN RETURN false; END IF;
  SELECT id INTO v_enc FROM public.encounters
   WHERE node_id = _node_id AND encounter_key = 'default' AND status IN ('active','idle');
  IF v_enc IS NULL THEN RETURN false; END IF;
  IF NOT public.encounter_has_pending_work(v_enc) THEN RETURN false; END IF;
  IF public.encounter_live_owner_active(v_enc) THEN RETURN false; END IF;
  PERFORM public.schedule_effects_catchup();
  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.schedule_effects_catchup() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unschedule_effects_catchup() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.arm_effects_catchup_for_node(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_effects_catchup() TO service_role;
GRANT EXECUTE ON FUNCTION public.unschedule_effects_catchup() TO service_role;
GRANT EXECUTE ON FUNCTION public.arm_effects_catchup_for_node(uuid) TO service_role;

-- 5. The dispatcher.
CREATE OR REPLACE FUNCTION public.effects_due_dispatch(_max_scopes integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
DECLARE
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_key text;
  v_mode text;
  s record;
  v_discovered integer := 0;
  v_pending integer := 0;
  v_claimed integer := 0;
  v_dispatch uuid;
BEGIN
  PERFORM public.sim_note_progress();

  IF NOT public.world_is_awake() THEN
    INSERT INTO public.effects_catchup_log (phase, outcome, reason)
    VALUES ('pass', 'skipped', 'world_asleep');
    PERFORM public.unschedule_effects_catchup();
    RETURN jsonb_build_object('ok', false, 'reason', 'world_asleep');
  END IF;

  SELECT COALESCE(value, 'open') INTO v_mode FROM public.combat_config WHERE key = 'combat_mode';

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'effects_catchup_service_role_key';

  FOR s IN
    SELECT * FROM public.effects_due_scopes(GREATEST(1, COALESCE(_max_scopes, 5)) * 4, v_now)
  LOOP
    v_discovered := v_discovered + 1;
    v_pending := v_pending + s.pending_count;

    CONTINUE WHEN s.due_count = 0;          -- future work: stay armed, do nothing
    CONTINUE WHEN s.live_owner;             -- healthy live owner advances effects
    CONTINUE WHEN v_claimed >= GREATEST(1, COALESCE(_max_scopes, 5));

    -- Maintenance: the ENTIRE scope must be explicitly granted.
    IF v_mode <> 'open' AND NOT public.effects_scope_grant_check(s.encounter_id, s.node_id) THEN
      INSERT INTO public.effects_catchup_log (encounter_id, node_id, phase, outcome, reason)
      VALUES (s.encounter_id, s.node_id, 'dispatch', 'refused', 'scope_not_granted');
      CONTINUE;
    END IF;

    -- Durable lease acquisition. The row, not a row lock, owns the dispatch.
    v_dispatch := gen_random_uuid();
    INSERT INTO public.effects_catchup_dispatch
      (encounter_id, node_id, dispatch_id, attempt, due_at_ms, lease_until)
    VALUES (s.encounter_id, s.node_id, v_dispatch, 1, s.due_at_ms, v_now + 10000)
    ON CONFLICT (encounter_id) DO UPDATE
      SET dispatch_id = EXCLUDED.dispatch_id,
          node_id = EXCLUDED.node_id,
          attempt = public.effects_catchup_dispatch.attempt + 1,
          due_at_ms = EXCLUDED.due_at_ms,
          lease_until = EXCLUDED.lease_until,
          updated_at = now()
      WHERE public.effects_catchup_dispatch.lease_until <= v_now
        AND public.effects_catchup_dispatch.backoff_until <= v_now;

    IF NOT FOUND THEN
      INSERT INTO public.effects_catchup_log (encounter_id, node_id, phase, outcome, reason)
      VALUES (s.encounter_id, s.node_id, 'dispatch', 'skipped', 'leased_or_backoff');
      CONTINUE;
    END IF;

    IF v_key IS NULL THEN
      INSERT INTO public.effects_catchup_log (encounter_id, node_id, phase, outcome, reason)
      VALUES (s.encounter_id, s.node_id, 'dispatch', 'failed', 'missing_credential');
      CONTINUE;
    END IF;

    PERFORM net.http_post(
      url := 'https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/combat-catchup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Lovable-Context', 'cron',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'scope', 'encounter',
        'encounter_id', s.encounter_id,
        'node_id', s.node_id,
        'due_at_ms', s.due_at_ms,
        'dispatch_id', v_dispatch
      )
    );

    v_claimed := v_claimed + 1;
    INSERT INTO public.effects_catchup_log
      (dispatch_id, encounter_id, node_id, phase, outcome, due_age_ms)
    VALUES (v_dispatch, s.encounter_id, s.node_id, 'dispatch', 'sent',
            GREATEST(0, v_now - s.due_at_ms));
  END LOOP;

  INSERT INTO public.effects_catchup_log (phase, outcome, scopes_discovered, scopes_claimed)
  VALUES ('pass', 'ok', v_discovered, v_claimed);

  -- Self-disarm ONLY when a locked recheck proves there is no pending
  -- effects-only work at all — future `next_tick_at` counts as pending.
  IF v_pending = 0 THEN
    PERFORM pg_advisory_xact_lock(7700000000000002);
    IF NOT EXISTS (SELECT 1 FROM public.effects_due_scopes(1, NULL)) THEN
      PERFORM public.unschedule_effects_catchup();
      DELETE FROM public.effects_catchup_dispatch WHERE lease_until <= v_now;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'discovered', v_discovered,
                            'pending', v_pending, 'claimed', v_claimed);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.effects_due_dispatch(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effects_due_dispatch(integer) TO service_role;

-- 6. Presence-transition arming.
CREATE OR REPLACE FUNCTION public.leave_encounter_engagements(_character_id uuid, _creature_id uuid DEFAULT NULL::uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_node uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'not your character';
  END IF;

  DELETE FROM public.encounter_engagements
  WHERE character_id = _character_id
    AND (_creature_id IS NULL OR creature_id = _creature_id);

  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'disengaged'
  WHERE character_id = _character_id
    AND status = 'pending'
    AND (_creature_id IS NULL OR target_creature_id = _creature_id);

  -- Departure is the authoritative live→effects-only handoff point.
  SELECT current_node_id INTO v_node FROM public.characters WHERE id = _character_id;
  BEGIN
    PERFORM public.arm_effects_catchup_for_node(v_node);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.encounter_disengage(_character_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_removed int;
  v_nodes uuid[];
  v_node uuid;
BEGIN
  WITH del AS (
    DELETE FROM public.encounter_participants
    WHERE character_id = _character_id
    RETURNING encounter_id
  )
  SELECT count(*)::int, COALESCE(array_agg(DISTINCT e.node_id), '{}')
    INTO v_removed, v_nodes
  FROM del JOIN public.encounters e ON e.id = del.encounter_id;

  FOREACH v_node IN ARRAY COALESCE(v_nodes, '{}') LOOP
    BEGIN
      PERFORM public.arm_effects_catchup_for_node(v_node);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  RETURN v_removed;
END;
$function$;

-- 7. World lifecycle wiring.
CREATE OR REPLACE FUNCTION public.tick_creatures()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.record_world_state();
  IF NOT public.world_is_awake() THEN RETURN; END IF;
  PERFORM public.sim_note_progress();
  PERFORM public.regen_creature_hp();
  PERFORM public.respawn_creatures();
END;
$function$;

CREATE OR REPLACE FUNCTION public.world_watchdog()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
DECLARE v_pending boolean;
BEGIN
  PERFORM public.record_world_state();
  IF public.world_is_awake() THEN
    PERFORM public.schedule_tick_creatures();
    -- Repair: pending effects-only work with no armed worker (abandoned tab,
    -- deleted job, missed arming) must not stall progression.
    SELECT EXISTS (SELECT 1 FROM public.effects_due_scopes(1, NULL)) INTO v_pending;
    IF v_pending THEN
      PERFORM public.schedule_effects_catchup();
    END IF;
  ELSE
    PERFORM public.unschedule_tick_creatures();
    PERFORM public.unschedule_effects_catchup();
    PERFORM public.sim_note_suspend();
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shutdown_world()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
DECLARE
  _job record;
  _tbl text;
  _realtime_tables text[] := ARRAY[
    'characters','creatures','marketplace_listings',
    'node_ground_loot','parties','party_members','summon_requests'
  ];
BEGIN
  FOR _job IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'world-watchdog','expire-timed-state','prune-logs','return-unique-items',
      'tick-creatures','process-email-queue','idle-shutdown-check','effects-catchup'
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

CREATE OR REPLACE FUNCTION public.wake_world()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'cron' AS $function$
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

  PERFORM public.schedule_tick_creatures();

  _healed := public.heal_creatures_on_wake();

  -- Authoritative resume boundary (policy C). Effect rows are NEVER mutated
  -- here: expiry is proposed by the resolver and committed by C2.
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

REVOKE ALL ON FUNCTION public.wake_world() FROM public;
GRANT EXECUTE ON FUNCTION public.wake_world() TO authenticated;

-- 8. Hourly log pruning.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-effects-catchup-log') THEN
    PERFORM cron.schedule('prune-effects-catchup-log', '23 * * * *',
      $c$SELECT public.prune_effects_catchup_log(2000);$c$);
  END IF;
END $$;

-- 9. Internal credential: derived from the existing vault service-role secret,
-- never exposed to clients or ordinary roles.
DO $$
DECLARE v_existing text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'effects_catchup_service_role_key') THEN
    SELECT decrypted_secret INTO v_existing
      FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key';
    IF v_existing IS NOT NULL THEN
      PERFORM vault.create_secret(v_existing, 'effects_catchup_service_role_key',
        'Service-role credential used only by public.effects_due_dispatch to invoke combat-catchup');
    END IF;
  END IF;
END $$;