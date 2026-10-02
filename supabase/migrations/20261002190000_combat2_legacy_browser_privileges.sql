-- ENG-LEGACY-002 batch C: privileges only; no function or gameplay-row mutation.
-- Lovable audit 2026-10-02T18:14:37Z supplied abbreviated definition MD5s.
-- They are drift markers, not full hashes/security attestations. Compare full
-- installed definitions with reviewed predecessors in the rollback-only gate.
DO $$
DECLARE
  spec record;
  fn oid;
  browser_role text;
  before_state jsonb := '[]'::jsonb;
  saved jsonb;
  current_state jsonb;
  internal_acl jsonb;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE EXCEPTION 'ENG-LEGACY-002 cannot verify effects-catchup schedules';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.rolname = current_user
      WHERE c.oid = 'cron.job'::regclass AND (NOT c.relrowsecurity OR r.rolsuper OR r.rolbypassrls
        OR (c.relowner = r.oid AND NOT c.relforcerowsecurity))) THEN
    RAISE EXCEPTION 'ENG-LEGACY-002 incomplete schedule visibility under RLS';
  END IF;
  -- Fence concurrent schedule creation for this transaction, never change jobs.
  LOCK TABLE cron.job IN SHARE MODE NOWAIT;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'effects-catchup'
      OR command ~* '\m(effects_due_dispatch|effects_catchup_send|effects_catchup_dispatch_one|effects_catchup_reconcile|schedule_effects_catchup)\M') THEN
    RAISE EXCEPTION 'ENG-LEGACY-002 effects-catchup schedule exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'ENG-LEGACY-002 required role missing';
  END IF;

  -- Complete preflight for ALL five targets before the first REVOKE.
  FOR spec IN SELECT * FROM (VALUES
    ('public.effects_catchup_send(uuid,uuid,bigint,uuid,integer)', 'effects_catchup_send', 'bigint', 'ecea10b2'),
    ('public.effects_catchup_dispatch_one(uuid)', 'effects_catchup_dispatch_one', 'jsonb', '6aabce3e'),
    ('public.effects_catchup_reconcile(integer)', 'effects_catchup_reconcile', 'jsonb', '867305d4'),
    ('public.effects_catchup_credential_health()', 'effects_catchup_credential_health', 'jsonb', 'b9fc05d8'),
    ('public.clear_stances(uuid)', 'clear_stances', 'jsonb', 'b45bbfa4')
  ) AS expected(signature, name, result_type, definition_md5_prefix) LOOP
    fn := to_regprocedure(spec.signature);
    IF fn IS NULL THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 missing predecessor: %', spec.signature;
    END IF;
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = spec.name) <> 1 THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 unexpected overload: %', spec.name;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = fn
        AND p.proowner = 'postgres'::regrole AND p.prosecdef
        AND p.prokind = 'f' AND p.provolatile = 'v'
        AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
        AND p.prorettype = spec.result_type::regtype
        AND p.proconfig = ARRAY['search_path=public']
        AND left(md5(pg_get_functiondef(p.oid)), 8) = spec.definition_md5_prefix) THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 predecessor definition/metadata drift: %', spec.signature;
    END IF;
    IF NOT has_function_privilege('postgres', fn, 'EXECUTE')
        OR NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 required internal access missing: %', spec.signature;
    END IF;

    -- PUBLIC and direct browser grants will be removed. Any remaining role
    -- grant reachable by inheritance OR membership needs a separate decision.
    -- MEMBER is deliberately conservative, including possible SET ROLE paths.
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolsuper
          AND (r.rolname = browser_role OR pg_has_role(browser_role, r.oid, 'MEMBER')))
          OR pg_has_role(browser_role, 'postgres', 'MEMBER')
          OR EXISTS (SELECT 1 FROM pg_proc p,
            LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = fn AND a.privilege_type = 'EXECUTE'
              AND a.grantee NOT IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
              AND (pg_has_role(browser_role, a.grantee, 'USAGE')
                OR pg_has_role(browser_role, a.grantee, 'MEMBER'))) THEN
        RAISE EXCEPTION 'ENG-LEGACY-002 inherited browser access needs separate decision: % / %', spec.signature, browser_role;
      END IF;
    END LOOP;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.grantee, a.grantor, a.is_grantable), '[]'::jsonb)
      INTO internal_acl FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = fn AND a.grantee NOT IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid);
    SELECT jsonb_build_object('oid', p.oid::text, 'catalogue', to_jsonb(p) - 'proacl',
      'definition', pg_get_functiondef(p.oid), 'internal_acl', internal_acl)
      INTO current_state FROM pg_proc p WHERE p.oid = fn;
    before_state := before_state || jsonb_build_array(current_state);
  END LOOP;

  REVOKE EXECUTE ON FUNCTION public.effects_catchup_send(uuid,uuid,bigint,uuid,integer) FROM PUBLIC,anon,authenticated;
  REVOKE EXECUTE ON FUNCTION public.effects_catchup_dispatch_one(uuid) FROM PUBLIC,anon,authenticated;
  REVOKE EXECUTE ON FUNCTION public.effects_catchup_reconcile(integer) FROM PUBLIC,anon,authenticated;
  REVOKE EXECUTE ON FUNCTION public.effects_catchup_credential_health() FROM PUBLIC,anon,authenticated;
  REVOKE EXECUTE ON FUNCTION public.clear_stances(uuid) FROM PUBLIC,anon,authenticated;

  -- In the same complete statement, verify denial and exact preservation.
  -- No exception is swallowed: any failure rolls back all five REVOKEs.
  FOR saved IN SELECT value FROM jsonb_array_elements(before_state) LOOP
    fn := (saved->>'oid')::oid;
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(browser_role, fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'ENG-LEGACY-002 effective browser denial failed: % / %', fn::regprocedure, browser_role;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 PUBLIC denial failed: %', fn::regprocedure;
    END IF;
    IF NOT has_function_privilege('postgres', fn, 'EXECUTE')
        OR NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 internal access lost: %', fn::regprocedure;
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.grantee, a.grantor, a.is_grantable), '[]'::jsonb)
      INTO internal_acl FROM pg_proc p,
        LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
      WHERE p.oid = fn AND a.grantee NOT IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid);
    SELECT jsonb_build_object('oid', p.oid::text, 'catalogue', to_jsonb(p) - 'proacl',
      'definition', pg_get_functiondef(p.oid), 'internal_acl', internal_acl)
      INTO current_state FROM pg_proc p WHERE p.oid = fn;
    IF current_state IS DISTINCT FROM saved THEN
      RAISE EXCEPTION 'ENG-LEGACY-002 definition/metadata/internal ACL changed: %', fn::regprocedure;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('effects_catchup_send',
        'effects_catchup_dispatch_one', 'effects_catchup_reconcile',
        'effects_catchup_credential_health', 'clear_stances')) <> 5 THEN
    RAISE EXCEPTION 'ENG-LEGACY-002 target set changed during revocation';
  END IF;
END;
$$;
