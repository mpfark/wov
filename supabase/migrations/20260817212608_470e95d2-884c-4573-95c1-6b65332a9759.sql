-- ─── 1. transport result ownership columns ──────────────────────────────────
ALTER TABLE public.effects_catchup_dispatch
  ADD COLUMN IF NOT EXISTS request_id bigint,
  ADD COLUMN IF NOT EXISTS request_generation integer,
  ADD COLUMN IF NOT EXISTS requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_status integer,
  ADD COLUMN IF NOT EXISTS last_transport_error text,
  ADD COLUMN IF NOT EXISTS last_class text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.effects_catchup_log
  ADD COLUMN IF NOT EXISTS request_id bigint,
  ADD COLUMN IF NOT EXISTS status integer,
  ADD COLUMN IF NOT EXISTS class text;

-- ─── 2. redaction helper ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redact_transport_text(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT left(
    regexp_replace(
      regexp_replace(COALESCE(_text, ''), '(?i)(bearer|apikey|authorization)[^,}"]*', '\1 [redacted]', 'g'),
      'ey[A-Za-z0-9_-]{10,}', '[redacted-token]', 'g'),
    300);
$function$;

-- ─── 3. dispatcher credential fingerprint check (internal only) ─────────────
CREATE OR REPLACE FUNCTION public.effects_dispatch_token_check(_token_sha256 text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_key text;
BEGIN
  IF _token_sha256 IS NULL OR length(_token_sha256) <> 64 THEN RETURN false; END IF;
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'effects_catchup_service_role_key';
  IF v_key IS NULL THEN RETURN false; END IF;
  RETURN lower(_token_sha256) = encode(sha256(convert_to(v_key, 'utf8')), 'hex');
END;
$function$;

REVOKE ALL ON FUNCTION public.effects_dispatch_token_check(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effects_dispatch_token_check(text) TO service_role;

-- ─── 4. reconciliation of pg_net responses ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.effects_catchup_reconcile(_max integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d record;
  r record;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_class text;
  v_retryable boolean;
  v_reason text;
  v_status int;
  v_err text;
  v_body jsonb;
  v_handled int := 0;
  v_pending int := 0;
BEGIN
  FOR d IN
    SELECT * FROM public.effects_catchup_dispatch
     WHERE request_id IS NOT NULL AND completed_at IS NULL
     ORDER BY requested_at ASC
     LIMIT GREATEST(1, COALESCE(_max, 20))
  LOOP
    v_class := NULL; v_retryable := false; v_reason := NULL;
    v_status := NULL; v_err := NULL; v_body := NULL;

    SELECT status_code, error_msg, content INTO r
      FROM net._http_response WHERE id = d.request_id;

    IF r IS NULL THEN
      -- No response row yet. Only a real timeout is authoritative.
      IF d.requested_at < now() - interval '15 seconds' THEN
        v_class := 'timeout'; v_retryable := true; v_reason := 'no_response_within_15s';
      ELSE
        v_pending := v_pending + 1;
        CONTINUE;
      END IF;
    ELSE
      v_status := r.status_code;
      v_err := public.redact_transport_text(r.error_msg);
      BEGIN v_body := r.content::jsonb; EXCEPTION WHEN others THEN v_body := NULL; END;

      IF r.error_msg IS NOT NULL THEN
        v_class := 'transport_failure'; v_retryable := true; v_reason := v_err;
      ELSIF v_status IS NULL THEN
        v_class := 'transport_failure'; v_retryable := true; v_reason := 'no_status';
      ELSIF v_status IN (401, 403) THEN
        v_class := 'gateway_rejected'; v_retryable := false;
        v_reason := COALESCE(v_body->>'reason', 'rejected_before_handler');
      ELSIF v_status = 404 THEN
        v_class := 'not_found'; v_retryable := false; v_reason := 'wrong_function_path';
      ELSIF v_status >= 500 THEN
        v_class := 'http_5xx'; v_retryable := true;
        v_reason := public.redact_transport_text(left(COALESCE(r.content, ''), 200));
      ELSIF v_status >= 400 THEN
        v_class := 'http_4xx'; v_retryable := false;
        v_reason := COALESCE(v_body->>'reason', 'client_error');
      ELSIF COALESCE(v_body->>'ok', '') = 'true' THEN
        v_class := 'delivered_committed'; v_retryable := false;
      ELSIF v_body IS NOT NULL AND COALESCE(v_body->>'ok', '') = 'false' THEN
        v_class := 'delivered_refused'; v_retryable := false;
        v_reason := COALESCE(v_body->>'kind', 'refused') || ':' || COALESCE(v_body->>'reason', '');
      ELSE
        v_class := 'delivered_unparsed'; v_retryable := false; v_reason := 'unparsable_body';
      END IF;
    END IF;

    -- Generation guard: only the attempt that owns this request may be mutated.
    UPDATE public.effects_catchup_dispatch t
       SET completed_at = now(),
           last_status = v_status,
           last_transport_error = v_err,
           last_class = v_class,
           last_outcome = COALESCE(t.last_outcome,
             CASE WHEN v_class = 'delivered_committed' THEN 'ok' ELSE v_class END),
           last_error = COALESCE(t.last_error, v_reason),
           failures = CASE
             WHEN v_class = 'delivered_committed' THEN 0
             WHEN t.last_outcome = 'ok' THEN t.failures
             ELSE t.failures + 1 END,
           lease_until = 0,
           backoff_until = CASE
             WHEN v_class = 'delivered_committed' OR t.last_outcome = 'ok' THEN 0
             WHEN v_retryable THEN v_now + LEAST(30000, 1000 * (2 ^ LEAST(t.failures + 1, 5))::int)
             ELSE v_now + 60000 END,
           updated_at = now()
     WHERE t.encounter_id = d.encounter_id
       AND t.dispatch_id = d.dispatch_id
       AND t.request_id = d.request_id
       AND t.request_generation = d.request_generation;

    IF FOUND THEN
      v_handled := v_handled + 1;
      INSERT INTO public.effects_catchup_log
        (dispatch_id, encounter_id, node_id, phase, outcome, reason, request_id, status, class)
      VALUES (d.dispatch_id, d.encounter_id, d.node_id, 'transport', v_class,
              public.redact_transport_text(v_reason), d.request_id, v_status, v_class);
    ELSE
      INSERT INTO public.effects_catchup_log
        (dispatch_id, encounter_id, node_id, phase, outcome, reason, request_id, status, class)
      VALUES (d.dispatch_id, d.encounter_id, d.node_id, 'transport', 'stale_response',
              public.redact_transport_text(v_reason), d.request_id, v_status, v_class);
    END IF;

    -- Consume the response row: never keep transport payloads around.
    DELETE FROM net._http_response WHERE id = d.request_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'handled', v_handled, 'awaiting', v_pending);
END;
$function$;

REVOKE ALL ON FUNCTION public.effects_catchup_reconcile(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.effects_catchup_reconcile(integer) TO service_role;