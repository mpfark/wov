-- ENG-PROGRESSION-001G-D3: reviewed forward ACL-only input.
-- Not installed. Lovable standard Drizzle tool registers this after authorization.
-- Preserve function ownership/body/search_path and existing service/internal access.
BEGIN;
DO $containment$
DECLARE
  target oid := 'public.admin_teleport(uuid,uuid)'::regprocedure;
  service_before boolean := has_function_privilege('service_role', target, 'EXECUTE');
BEGIN
  IF (SELECT prorettype FROM pg_proc WHERE oid=target) <> 'void'::regtype THEN
    RAISE EXCEPTION 'D3 unexpected admin_teleport return type';
  END IF;
  REVOKE EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) FROM PUBLIC, anon, authenticated;
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
             WHERE p.oid=target AND a.grantee=0 AND a.privilege_type='EXECUTE')
     OR has_function_privilege('anon',target,'EXECUTE')
     OR has_function_privilege('authenticated',target,'EXECUTE') THEN
    RAISE EXCEPTION 'D3 browser inherited EXECUTE remains; review exact role dependency';
  END IF;
  IF has_function_privilege('service_role',target,'EXECUTE') IS DISTINCT FROM service_before THEN
    RAISE EXCEPTION 'D3 service EXECUTE changed unexpectedly';
  END IF;
END;
$containment$;
COMMIT;
