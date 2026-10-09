-- Last component of B, never install alone. All B components must share ONE transaction.
DO $gates$
BEGIN
  IF current_user<>'postgres' OR NOT has_table_privilege(current_user,'auth.users','TRIGGER')
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass
      AND tgname='character_lifecycle_character_fence' AND NOT tgisinternal AND tgenabled='O')
    OR to_regprocedure('public.character_receipt_maintenance_internal()') IS NULL
  THEN RAISE EXCEPTION 'integrated support / lifecycle fence / auth trigger privilege required'; END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND tgname='character_c2_account_deleted')
  THEN RAISE EXCEPTION 'account trigger namespace conflict'; END IF;
END $gates$;
CREATE TRIGGER character_c2_account_deleted AFTER DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.character_account_deleted_internal();

-- Administrative retention housekeeping, not a gameplay heartbeat or auto purge.
DO $maintenance$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron')
    OR to_regprocedure('cron.schedule(text,text,text)') IS NULL
  THEN RAISE EXCEPTION 'existing pg_cron required; do not install a new runner'; END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='character-c2-receipt-expiry')
  THEN RAISE EXCEPTION 'receipt maintenance job already exists'; END IF;
  PERFORM cron.schedule('character-c2-receipt-expiry','17 3 * * *',
    'SELECT public.character_receipt_maintenance_internal();');
END $maintenance$;

GRANT EXECUTE ON FUNCTION public.character_create_c2(uuid,text,text,text,uuid,text,text),
  public.character_creation_capacity(uuid) TO authenticated;
DO $boundary$
DECLARE f oid; r oid;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.character_create_c2(uuid,text,text,text,uuid,text,text)'::regprocedure::oid,
    'public.character_creation_capacity(uuid)'::regprocedure::oid,
    'public.character_lifecycle_command(uuid,uuid,bigint,text,text)'::regprocedure::oid] LOOP
    IF NOT has_function_privilege('authenticated',f,'EXECUTE')
      OR has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('service_role',f,'EXECUTE')
    THEN RAISE EXCEPTION 'integrated public execution boundary drift'; END IF;
  END LOOP;
END $boundary$;
