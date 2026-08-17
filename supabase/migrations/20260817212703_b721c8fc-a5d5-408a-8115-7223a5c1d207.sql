CREATE OR REPLACE FUNCTION public.effects_catchup_send(
  _encounter_id uuid, _node_id uuid, _due_at_ms bigint, _dispatch_id uuid, _generation integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_key text; v_req bigint;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'effects_catchup_service_role_key';
  IF v_key IS NULL THEN RETURN NULL; END IF;

  SELECT net.http_post(
    url := 'https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/combat-catchup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'apikey', v_key,
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'scope', 'encounter',
      'encounter_id', _encounter_id,
      'node_id', _node_id,
      'due_at_ms', _due_at_ms,
      'dispatch_id', _dispatch_id
    ),
    timeout_milliseconds := 12000
  ) INTO v_req;

  UPDATE public.effects_catchup_dispatch
     SET request_id = v_req,
         request_generation = _generation,
         requested_at = now(),
         completed_at = NULL,
         last_status = NULL,
         last_transport_error = NULL,
         last_class = NULL,
         last_outcome = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE encounter_id = _encounter_id AND dispatch_id = _dispatch_id;

  RETURN v_req;
END;
$function$;

REVOKE ALL ON FUNCTION public.effects_catchup_send(uuid, uuid, bigint, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effects_catchup_send(uuid, uuid, bigint, uuid, integer) TO service_role;

-- ─── dispatcher pass ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.effects_due_dispatch(_max_scopes integer DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_mode text;
  s record;
  v_discovered integer := 0;
  v_pending integer := 0;
  v_claimed integer := 0;
  v_dispatch uuid;
  v_gen integer;
  v_req bigint;
  v_recon jsonb;
BEGIN
  PERFORM public.sim_note_progress();

  IF NOT public.world_is_awake() THEN
    INSERT INTO public.effects_catchup_log (phase, outcome, reason)
    VALUES ('pass', 'skipped', 'world_asleep');
    PERFORM public.unschedule_effects_catchup();
    RETURN jsonb_build_object('ok', false, 'reason', 'world_asleep');
  END IF;

  -- Transport ownership: settle prior requests before issuing new ones.
  v_recon := public.effects_catchup_reconcile(20);

  SELECT COALESCE(value, 'open') INTO v_mode FROM public.combat_config WHERE key = 'combat_mode';

  FOR s IN
    SELECT * FROM public.effects_due_scopes(GREATEST(1, COALESCE(_max_scopes, 5)) * 4, v_now)
  LOOP
    v_discovered := v_discovered + 1;
    v_pending := v_pending + s.pending_count;

    CONTINUE WHEN s.due_count = 0;
    CONTINUE WHEN s.live_owner;
    CONTINUE WHEN v_claimed >= GREATEST(1, COALESCE(_max_scopes, 5));

    IF v_mode <> 'open' AND NOT public.effects_scope_grant_check(s.encounter_id, s.node_id) THEN
      INSERT INTO public.effects_catchup_log (encounter_id, node_id, phase, outcome, reason)
      VALUES (s.encounter_id, s.node_id, 'dispatch', 'refused', 'scope_not_granted');
      CONTINUE;
    END IF;

    -- An unresolved in-flight HTTP request owns this encounter until it
    -- resolves or times out. Never stack a second request on top of it.
    IF EXISTS (
      SELECT 1 FROM public.effects_catchup_dispatch t
       WHERE t.encounter_id = s.encounter_id
         AND t.request_id IS NOT NULL
         AND t.completed_at IS NULL
         AND t.requested_at > now() - interval '15 seconds'
    ) THEN
      INSERT INTO public.effects_catchup_log (encounter_id, node_id, phase, outcome, reason)
      VALUES (s.encounter_id, s.node_id, 'dispatch', 'skipped', 'awaiting_response');
      CONTINUE;
    END IF;

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
        AND public.effects_catchup_dispatch.backoff_until <= v_now
    RETURNING attempt INTO v_gen;

    IF v_gen IS NULL THEN
      INSERT INTO public.effects_catchup_log (encounter_id, node_id, phase, outcome, reason)
      VALUES (s.encounter_id, s.node_id, 'dispatch', 'skipped', 'leased_or_backoff');
      CONTINUE;
    END IF;

    v_req := public.effects_catchup_send(s.encounter_id, s.node_id, s.due_at_ms, v_dispatch, v_gen);

    IF v_req IS NULL THEN
      UPDATE public.effects_catchup_dispatch
         SET lease_until = 0, last_outcome = 'missing_credential',
             last_class = 'missing_credential', failures = failures + 1,
             completed_at = now(), updated_at = now()
       WHERE encounter_id = s.encounter_id AND dispatch_id = v_dispatch;
      INSERT INTO public.effects_catchup_log (dispatch_id, encounter_id, node_id, phase, outcome, reason)
      VALUES (v_dispatch, s.encounter_id, s.node_id, 'dispatch', 'failed', 'missing_credential');
      CONTINUE;
    END IF;

    v_claimed := v_claimed + 1;
    INSERT INTO public.effects_catchup_log
      (dispatch_id, encounter_id, node_id, phase, outcome, due_age_ms, request_id)
    VALUES (v_dispatch, s.encounter_id, s.node_id, 'dispatch', 'sent',
            GREATEST(0, v_now - s.due_at_ms), v_req);
  END LOOP;

  INSERT INTO public.effects_catchup_log (phase, outcome, scopes_discovered, scopes_claimed)
  VALUES ('pass', 'ok', v_discovered, v_claimed);

  IF v_pending = 0 THEN
    PERFORM pg_advisory_xact_lock(7700000000000002);
    IF NOT EXISTS (SELECT 1 FROM public.effects_due_scopes(1, NULL)) THEN
      PERFORM public.unschedule_effects_catchup();
      DELETE FROM public.effects_catchup_dispatch
       WHERE lease_until <= v_now AND (request_id IS NULL OR completed_at IS NOT NULL);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'discovered', v_discovered,
                            'pending', v_pending, 'claimed', v_claimed,
                            'reconciled', v_recon);
END;
$function$;

-- ─── callback marks the attempt complete ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_effects_catchup_result(
  _dispatch_id uuid, _encounter_id uuid, _outcome text, _reason text DEFAULT NULL::text,
  _ticks integer DEFAULT 0, _effects integer DEFAULT 0, _deaths integer DEFAULT 0,
  _duration_ms integer DEFAULT NULL::integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.effects_catchup_dispatch;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_failure boolean;
BEGIN
  SELECT * INTO d FROM public.effects_catchup_dispatch
   WHERE encounter_id = _encounter_id FOR UPDATE;

  IF d.encounter_id IS NULL OR d.dispatch_id IS DISTINCT FROM _dispatch_id THEN
    INSERT INTO public.effects_catchup_log
      (dispatch_id, encounter_id, phase, outcome, reason, ticks, effects, deaths, duration_ms)
    VALUES (_dispatch_id, _encounter_id, 'result', 'stale_callback', _outcome,
            _ticks, _effects, _deaths, _duration_ms);
    RETURN 'stale_callback';
  END IF;

  v_failure := _outcome IN ('internal', 'commit_refused', 'lease_lost', 'transport_error',
                            'resolver_failed', 'config_conflict');

  UPDATE public.effects_catchup_dispatch
     SET lease_until = 0,
         completed_at = now(),
         last_outcome = _outcome,
         last_error = public.redact_transport_text(_reason),
         last_class = CASE WHEN v_failure THEN 'callback_failure' ELSE 'callback_ok' END,
         failures = CASE WHEN v_failure THEN failures + 1 ELSE 0 END,
         backoff_until = CASE
           WHEN v_failure AND failures + 1 >= 5 THEN v_now + 30000
           ELSE 0
         END,
         updated_at = now()
   WHERE encounter_id = _encounter_id AND dispatch_id = _dispatch_id;

  INSERT INTO public.effects_catchup_log
    (dispatch_id, encounter_id, node_id, phase, outcome, reason, ticks, effects, deaths, duration_ms)
  VALUES (_dispatch_id, _encounter_id, d.node_id, 'result', _outcome,
          public.redact_transport_text(_reason), _ticks, _effects, _deaths, _duration_ms);

  RETURN 'recorded';
END;
$function$;

-- ─── controlled single dispatch (internal validation) ───────────────────────
CREATE OR REPLACE FUNCTION public.effects_catchup_dispatch_one(_encounter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_dispatch uuid := gen_random_uuid();
  v_gen integer;
  v_req bigint;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO s FROM public.effects_due_scopes(50, v_now) WHERE encounter_id = _encounter_id;
  IF s.encounter_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_scope'); END IF;
  IF s.due_count = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'nothing_due'); END IF;

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
  RETURNING attempt INTO v_gen;

  v_req := public.effects_catchup_send(s.encounter_id, s.node_id, s.due_at_ms, v_dispatch, v_gen);

  INSERT INTO public.effects_catchup_log
    (dispatch_id, encounter_id, node_id, phase, outcome, due_age_ms, request_id)
  VALUES (v_dispatch, s.encounter_id, s.node_id, 'dispatch', 'sent_manual',
          GREATEST(0, v_now - s.due_at_ms), v_req);

  RETURN jsonb_build_object('ok', v_req IS NOT NULL, 'dispatch_id', v_dispatch,
                            'attempt', v_gen, 'request_id', v_req,
                            'node_id', s.node_id, 'due_at_ms', s.due_at_ms);
END;
$function$;

REVOKE ALL ON FUNCTION public.effects_catchup_dispatch_one(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effects_catchup_dispatch_one(uuid) TO service_role;