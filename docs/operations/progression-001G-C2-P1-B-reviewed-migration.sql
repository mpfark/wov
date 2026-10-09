-- ENG-PROGRESSION-001G-C2-P1-B: local S1 preparation, NOT INSTALLED.
-- Submit only through a separately authorized standard Lovable Drizzle transaction.
-- Journal/snapshots remain the installed prefix; registration belongs to installation.
-- Empty private storage only: no creation RPC, initializer, name index or data writes.

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.characters'::regclass AND attname = 'id'
      AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.users'::regclass AND attname = 'id'
      AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped)
  THEN RAISE EXCEPTION 'creation storage identity dependency drift'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = 'character_creation_storage_guard')
  THEN RAISE EXCEPTION 'creation storage guard namespace conflict'; END IF;
END
$preflight$;

CREATE TABLE public.character_creation_origin (
  character_id uuid PRIMARY KEY REFERENCES public.characters(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  snapshot_schema_version smallint NOT NULL CHECK (snapshot_schema_version = 1),
  creation_version text NOT NULL CHECK (btrim(creation_version) <> ''),
  race_version text NOT NULL CHECK (btrim(race_version) <> ''),
  class_version text NOT NULL CHECK (btrim(class_version) <> ''),
  formula_version text NOT NULL CHECK (btrim(formula_version) <> ''),
  applied_snapshot jsonb NOT NULL CHECK (jsonb_typeof(applied_snapshot) = 'object'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at))
);

CREATE TABLE public.character_creation_log (
  log_id uuid PRIMARY KEY,
  actor_id uuid,
  request_id uuid,
  target_account_id uuid,
  result_character_id uuid,
  payload_version smallint CHECK (payload_version = 1),
  payload_digest bytea CHECK (octet_length(payload_digest) = 32),
  replay_status text NOT NULL CHECK (replay_status IN ('applied', 'purged', 'retired')),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  details_expires_at timestamptz NOT NULL CHECK (isfinite(details_expires_at)),
  detailed_receipt jsonb CHECK (jsonb_typeof(detailed_receipt) = 'object'),
  CONSTRAINT character_creation_log_request_key UNIQUE (actor_id, request_id),
  CONSTRAINT character_creation_log_result_key UNIQUE (result_character_id),
  CONSTRAINT character_creation_log_replay_fields CHECK (
    (replay_status IN ('applied', 'purged') AND actor_id IS NOT NULL
      AND request_id IS NOT NULL AND target_account_id IS NOT NULL
      AND result_character_id IS NOT NULL AND payload_version IS NOT NULL
      AND payload_digest IS NOT NULL)
    OR (replay_status = 'retired' AND actor_id IS NULL AND request_id IS NULL
      AND target_account_id IS NULL AND result_character_id IS NULL
      AND payload_version IS NULL AND payload_digest IS NULL)
  ),
  CONSTRAINT character_creation_log_detail_retention CHECK (
    details_expires_at = ((created_at AT TIME ZONE 'UTC') + interval '12 months')
      AT TIME ZONE 'UTC'
  )
);
CREATE INDEX character_creation_log_detail_expiry_idx
  ON public.character_creation_log (details_expires_at)
  WHERE detailed_receipt IS NOT NULL;

ALTER TABLE public.character_creation_origin OWNER TO postgres;
ALTER TABLE public.character_creation_log OWNER TO postgres;
ALTER TABLE public.character_creation_origin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_creation_log ENABLE ROW LEVEL SECURITY;
-- No policies; owner-private operations only. FORCE RLS remains false.
REVOKE ALL PRIVILEGES ON public.character_creation_origin,
  public.character_creation_log FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.character_creation_storage_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $guard$
BEGIN
  IF TG_RELID = 'public.character_creation_origin'::regclass THEN
    RAISE EXCEPTION 'creation origin is immutable';
  END IF;
  IF TG_RELID <> 'public.character_creation_log'::regclass THEN
    RAISE EXCEPTION 'unexpected creation storage guard attachment';
  END IF;

  IF ROW(NEW.log_id, NEW.created_at, NEW.details_expires_at)
    IS DISTINCT FROM ROW(OLD.log_id, OLD.created_at, OLD.details_expires_at)
  THEN RAISE EXCEPTION 'creation log identity and timestamps are immutable'; END IF;

  IF NEW.detailed_receipt IS DISTINCT FROM OLD.detailed_receipt THEN
    IF OLD.detailed_receipt IS NULL OR NEW.detailed_receipt IS NOT NULL
      OR statement_timestamp() < OLD.details_expires_at
    THEN RAISE EXCEPTION 'creation details may only be cleared at expiry'; END IF;
  END IF;

  IF NEW.replay_status = OLD.replay_status
    OR (OLD.replay_status = 'applied' AND NEW.replay_status = 'purged') THEN
    IF ROW(NEW.actor_id, NEW.request_id, NEW.target_account_id,
      NEW.result_character_id, NEW.payload_version, NEW.payload_digest)
      IS DISTINCT FROM ROW(OLD.actor_id, OLD.request_id, OLD.target_account_id,
      OLD.result_character_id, OLD.payload_version, OLD.payload_digest)
    THEN RAISE EXCEPTION 'creation replay binding is immutable'; END IF;
    IF NEW.replay_status = 'purged' AND OLD.replay_status = 'applied'
      AND EXISTS (SELECT 1 FROM public.characters WHERE id = OLD.result_character_id)
    THEN RAISE EXCEPTION 'creation result still exists'; END IF;
  ELSIF OLD.replay_status IN ('applied', 'purged') AND NEW.replay_status = 'retired' THEN
    IF EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.actor_id) THEN
      RAISE EXCEPTION 'creation replay actor still exists';
    END IF;
    -- The ordinary CHECK requires all six replay fields NULL after retirement.
  ELSE
    RAISE EXCEPTION 'invalid creation replay status transition';
  END IF;
  RETURN NEW;
END
$guard$;
ALTER FUNCTION public.character_creation_storage_guard() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.character_creation_storage_guard()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER character_creation_origin_immutable
  BEFORE UPDATE ON public.character_creation_origin FOR EACH ROW
  EXECUTE FUNCTION public.character_creation_storage_guard();
CREATE TRIGGER character_creation_log_lifecycle
  BEFORE UPDATE ON public.character_creation_log FOR EACH ROW
  EXECUTE FUNCTION public.character_creation_storage_guard();

-- Remove only new-object default ACL grants, including nonstandard principals.
-- Never change role membership, default privileges or existing object privileges.
DO $private_acl$
DECLARE object_id oid; grantee oid; column_names text;
BEGIN
  FOREACH object_id IN ARRAY ARRAY['public.character_creation_origin'::regclass::oid,
    'public.character_creation_log'::regclass::oid] LOOP
    FOR grantee IN SELECT DISTINCT a.grantee FROM pg_catalog.pg_class c,
      LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid = object_id AND a.grantee <> c.relowner LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %s',
        object_id::regclass, CASE WHEN grantee = 0 THEN 'PUBLIC'
          ELSE quote_ident(pg_catalog.pg_get_userbyid(grantee)) END);
    END LOOP;
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO column_names
      FROM pg_catalog.pg_attribute WHERE attrelid = object_id
        AND attnum > 0 AND NOT attisdropped;
    FOR grantee IN SELECT DISTINCT a.grantee FROM pg_catalog.pg_attribute col,
      LATERAL pg_catalog.aclexplode(col.attacl) a
      WHERE col.attrelid = object_id AND a.grantee <> 'postgres'::regrole LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE %s FROM %s',
        column_names, object_id::regclass, CASE WHEN grantee = 0 THEN 'PUBLIC'
          ELSE quote_ident(pg_catalog.pg_get_userbyid(grantee)) END);
    END LOOP;
  END LOOP;
  FOR grantee IN SELECT DISTINCT a.grantee FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(p.proacl) a
    WHERE p.oid = 'public.character_creation_storage_guard()'::regprocedure
      AND a.grantee <> p.proowner LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION public.character_creation_storage_guard() FROM %s',
      CASE WHEN grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_catalog.pg_get_userbyid(grantee)) END);
  END LOOP;
END
$private_acl$;

DO $assert_private$
DECLARE object_id oid; guard_id oid := 'public.character_creation_storage_guard()'::regprocedure;
BEGIN
  FOREACH object_id IN ARRAY ARRAY['public.character_creation_origin'::regclass::oid,
    'public.character_creation_log'::regclass::oid] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = object_id
      AND (c.relowner <> 'postgres'::regrole OR NOT c.relrowsecurity OR c.relforcerowsecurity))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = object_id)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
        LATERAL pg_catalog.aclexplode(c.relacl) a
        WHERE c.oid = object_id AND a.grantee <> c.relowner)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col,
        LATERAL pg_catalog.aclexplode(col.attacl) a
        WHERE col.attrelid = object_id AND a.grantee <> 'postgres'::regrole)
    THEN RAISE EXCEPTION 'creation storage owner/RLS/direct ACL drift'; END IF;
    -- Established capability-based platform exception; application members never exempt.
    IF EXISTS (WITH RECURSIVE application_members(oid) AS (
        SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role')
        UNION SELECT m.member FROM pg_catalog.pg_auth_members m
          JOIN application_members a ON m.roleid = a.oid
      ) SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname <> 'postgres'
      AND (r.oid IN (SELECT oid FROM application_members)
        OR (NOT r.rolsuper AND NOT r.rolbypassrls AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles authority
          WHERE authority.rolname IN ('pg_read_all_data','pg_write_all_data')
            AND pg_catalog.pg_has_role(r.oid, authority.oid, 'USAGE'))))
      AND (pg_catalog.has_table_privilege(r.oid, object_id,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(r.oid, object_id,
          'SELECT,INSERT,UPDATE,REFERENCES')))
    THEN RAISE EXCEPTION 'creation storage effective application privilege leak'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = guard_id
    AND (p.proowner <> 'postgres'::regrole OR p.prosecdef
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid = guard_id AND a.grantee <> p.proowner)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname <> 'postgres'
      AND (NOT r.rolsuper OR EXISTS (
        WITH RECURSIVE application_members(oid) AS (
          SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role')
          UNION SELECT m.member FROM pg_catalog.pg_auth_members m
            JOIN application_members a ON m.roleid = a.oid
        ) SELECT 1 FROM application_members WHERE oid = r.oid))
      AND pg_catalog.has_function_privilege(r.oid, guard_id, 'EXECUTE'))
  THEN RAISE EXCEPTION 'creation storage guard privilege leak'; END IF;
END
$assert_private$;
