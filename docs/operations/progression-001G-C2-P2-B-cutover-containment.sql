-- ACTIVATION-ONLY PREPARATION, NOT AUTHORIZATION. Standard tool, atomic transaction.
-- Stops old creation/deletion; bridge stays owner-only. No new public creation grant.
-- Run only in an approved creation/deletion maintenance window after inactive package.
DO $dependencies$
BEGIN
  IF to_regprocedure('public.character_create_c2(uuid,text,text,text,uuid,text,text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.character_materials'::regclass
      AND conname='character_materials_character_id_c2_fkey' AND contype='f')
  THEN RAISE EXCEPTION 'inactive P2-B package required'; END IF;
END $dependencies$;

-- Validate only; any orphan aborts this transaction. No automatic deletion/repair.
ALTER TABLE public.character_materials VALIDATE CONSTRAINT character_materials_character_id_c2_fkey;

-- Identified browser legacy caller and historical creation harnesses; retain owner access.
-- delete_character_cascade is deliberately disabled pending approved soft-delete lifecycle.
DO $functions$
DECLARE f record; grantee oid;
BEGIN
  FOR f IN SELECT p.oid,p.proowner,p.oid::regprocedure AS identity FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('character_create','c2_harness_run','c2_harness_run_c','delete_character_cascade') LOOP
    IF f.proowner<>'postgres'::regrole THEN RAISE EXCEPTION 'unexpected legacy function owner: %',f.identity; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.identity);
    FOR grantee IN SELECT DISTINCT a.grantee FROM pg_proc p,LATERAL aclexplode(p.proacl) a
      WHERE p.oid=f.oid AND a.grantee<>p.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',f.identity,
        CASE WHEN grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grantee)) END);
    END LOOP;
    IF EXISTS (WITH RECURSIVE app(oid) AS (
      SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
      UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
      SELECT 1 FROM app WHERE oid<>f.proowner AND has_function_privilege(oid,f.oid,'EXECUTE'))
    THEN RAISE EXCEPTION 'legacy inherited execute leak: %',f.identity; END IF;
  END LOOP;
END $functions$;

-- No direct creation consumer found in current browser/Edge code; harnesses above
-- use postgres definer writes. Do not change protected/unprotected UPDATE grants.
REVOKE INSERT,DELETE ON TABLE public.characters FROM PUBLIC,anon,authenticated,service_role;
DO $characters_acl$
DECLARE col text; r oid;
BEGIN
  FOR col IN SELECT attname FROM pg_attribute WHERE attrelid='public.characters'::regclass
    AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%I) ON public.characters FROM PUBLIC,anon,authenticated,service_role',col);
  END LOOP;
  FOR r IN WITH RECURSIVE app(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
    UNION SELECT m.member FROM pg_auth_members m JOIN app ON m.roleid=app.oid)
    SELECT oid FROM app WHERE oid<>'postgres'::regrole LOOP
    IF has_table_privilege(r,'public.characters','INSERT,DELETE')
      OR has_any_column_privilege(r,'public.characters','INSERT')
    THEN RAISE EXCEPTION 'inherited direct creation/deletion leak: %',pg_get_userbyid(r); END IF;
    IF has_function_privilege(r,'public.character_create_c2(uuid,text,text,text,uuid,text,text)','EXECUTE')
    THEN RAISE EXCEPTION 'bridge must remain paused until lifecycle/activation gates clear'; END IF;
  END LOOP;
END $characters_acl$;
