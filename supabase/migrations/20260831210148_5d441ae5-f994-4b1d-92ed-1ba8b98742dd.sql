CREATE OR REPLACE FUNCTION public.combat2_provision_worker_secret(_secret text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'vault'
AS $function$
DECLARE
  v_count integer;
  v_id uuid;
BEGIN
  IF _secret IS NULL OR pg_catalog.length(pg_catalog.btrim(_secret)) < 16 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'classification', 'invalid_secret');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('combat2-worker-secret-provision'));

  BEGIN
    SELECT pg_catalog.count(*) INTO v_count
      FROM vault.secrets s
     WHERE s.name = 'COMBAT2_WORKER_SECRET';

    IF v_count > 1 THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'classification', 'ambiguous_secret_state');
    END IF;

    IF v_count = 0 THEN
      PERFORM vault.create_secret(_secret, 'COMBAT2_WORKER_SECRET', 'Combat2 dispatcher worker bearer secret');
      RETURN pg_catalog.jsonb_build_object('ok', true, 'classification', 'created');
    END IF;

    SELECT s.id INTO v_id
      FROM vault.secrets s
     WHERE s.name = 'COMBAT2_WORKER_SECRET';

    PERFORM vault.update_secret(v_id, _secret);
    RETURN pg_catalog.jsonb_build_object('ok', true, 'classification', 'updated');
  EXCEPTION WHEN OTHERS THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'classification', 'vault_write_failed');
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.combat2_provision_worker_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_provision_worker_secret(text) TO service_role;