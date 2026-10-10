-- A: dormant support only. Standard Lovable Drizzle transaction; not installed.
-- No grants to application roles, attached account trigger, job or gameplay writes.
DO $dependencies$
BEGIN
  IF current_user<>'postgres' OR to_regprocedure('public.character_lifecycle_expire_receipts_internal()') IS NULL
    OR to_regprocedure('public.character_create_c2(uuid,text,text,text,uuid,text,text)') IS NULL
  THEN RAISE EXCEPTION 'installed private 0007-0011 / postgres required'; END IF;
END $dependencies$;

CREATE FUNCTION public.character_creation_capacity(_target uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); target uuid:=coalesce(_target,actor); total integer;
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target)
    OR (actor<>target AND NOT public.has_role(actor,'overlord'::public.app_role))
  THEN RAISE EXCEPTION 'creation_capacity_not_authorized' USING ERRCODE='42501'; END IF;
  SELECT count(*)::integer INTO total FROM public.characters WHERE user_id=target;
  RETURN jsonb_build_object('retained',total,'limit',5);
END $$;

CREATE FUNCTION public.character_creation_expire_receipts_internal() RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE changed bigint; removed bigint;
BEGIN
  UPDATE public.character_creation_log SET detailed_receipt=NULL
    WHERE detailed_receipt IS NOT NULL AND details_expires_at<=statement_timestamp();
  GET DIAGNOSTICS changed=ROW_COUNT;
  DELETE FROM public.character_creation_log WHERE replay_status='retired'
    AND detailed_receipt IS NULL AND details_expires_at<=statement_timestamp();
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN changed+removed;
END $$;

CREATE FUNCTION public.character_receipt_maintenance_internal() RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE changed bigint; removed bigint;
BEGIN
  -- Consistent ledger order with account cleanup: creation, then lifecycle.
  changed:=public.character_creation_expire_receipts_internal();
  changed:=changed+public.character_lifecycle_expire_receipts_internal();
  DELETE FROM public.character_lifecycle_receipt r WHERE r.operation='purge'
    AND r.details_expires_at<=statement_timestamp()
    AND NOT EXISTS(SELECT 1 FROM auth.users a WHERE a.id=r.actor_id);
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN changed+removed;
END $$;

CREATE FUNCTION public.character_account_deleted_internal() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE retired uuid[];
BEGIN
  IF TG_OP<>'DELETE' OR TG_RELID<>'auth.users'::regclass
    OR EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.id)
  THEN RAISE EXCEPTION 'controlled account deletion boundary required'; END IF;
  -- The auth DELETE holds the identity row lock. Commands take KEY SHARE before
  -- touching either ledger. Do NOT take account advisory locks here (lock inversion).
  -- Parent character fence rejects account cascades until explicit eligible purge.
  WITH changed AS (UPDATE public.character_creation_log SET replay_status='retired',actor_id=NULL,request_id=NULL,
    target_account_id=NULL,result_character_id=NULL,payload_version=NULL,payload_digest=NULL
    WHERE actor_id=OLD.id AND replay_status IN ('applied','purged') RETURNING log_id)
    SELECT array_agg(log_id) INTO retired FROM changed;
  UPDATE public.character_creation_log SET detailed_receipt=NULL WHERE log_id=ANY(retired)
    AND details_expires_at<=statement_timestamp() AND detailed_receipt IS NOT NULL;
  DELETE FROM public.character_creation_log WHERE log_id=ANY(retired)
    AND details_expires_at<=statement_timestamp() AND detailed_receipt IS NULL;
  DELETE FROM public.character_lifecycle_receipt WHERE actor_id=OLD.id
    AND details_expires_at<=statement_timestamp();
  -- Unexpired history finishes its original 12 months. Recipient origins untouched.
  RETURN OLD;
END $$;

DO $private_acl$
DECLARE f record; g oid;
BEGIN
  FOR f IN SELECT p.oid,p.oid::regprocedure identity FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname IN
      ('character_creation_capacity','character_creation_expire_receipts_internal',
       'character_receipt_maintenance_internal','character_account_deleted_internal') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f.identity);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);
    FOR g IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a
      WHERE p.oid=f.oid AND a.grantee<>'postgres'::regrole LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.identity,
        CASE WHEN g=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g)) END);
    END LOOP;
    IF EXISTS(WITH RECURSIVE app(oid) AS (
      SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
      UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
      SELECT 1 FROM app WHERE oid<>'postgres'::regrole AND has_function_privilege(oid,f.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'private support inherited EXECUTE leak: %',f.identity; END IF;
  END LOOP;
END $private_acl$;
