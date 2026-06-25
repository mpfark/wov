
CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  msg_id bigint;
  v_retry_until timestamptz;
BEGIN
  BEGIN
    msg_id := pgmq.send(queue_name, payload);
  EXCEPTION WHEN undefined_table THEN
    PERFORM pgmq.create(queue_name);
    msg_id := pgmq.send(queue_name, payload);
  END;

  BEGIN
    SELECT retry_after_until INTO v_retry_until
    FROM public.email_send_state WHERE id = 1;

    IF v_retry_until IS NULL OR v_retry_until <= now() THEN
      PERFORM net.http_post(
        url := 'https://gpclaklkaolyzfnooajt.supabase.co/functions/v1/process-email-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Lovable-Context', 'enqueue',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := '{}'::jsonb
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN msg_id;
END;
$function$;

SELECT cron.alter_job(
  job_id := 14,
  schedule := '*/1 * * * *'
);
