-- PREPARATION ONLY: one catalog SELECT, not execution approval.
-- Requires an explicitly approved route already enforcing transaction_read_only=on.
WITH targets(identity,purpose) AS (VALUES
 ('public.combat2_session_access(uuid,uuid)','activation boundary'),
 ('public.idle_shutdown_check()','correction target'),
 ('public.wake_world()','direct activation dependency'),
 ('public.shutdown_world()','direct idle/activation-failure dependency'),
 ('public.combat2_dispatch_scheduler_enable()','direct activation scheduler dependency'),
 ('public.combat2_dispatch_scheduler_disable()','direct idle scheduler dependency'),
 ('public.return_unique_items()','direct idle pre-shutdown dependency')
), functions AS (
 SELECT t.identity AS requested_identity,t.purpose,p.oid IS NOT NULL AS exists,
 p.oid::regprocedure::text AS installed_identity,
 pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
 pg_catalog.pg_get_function_result(p.oid) AS result_type,
 pg_catalog.pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,
 p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig,
 p.prosrc AS source,pg_catalog.pg_get_functiondef(p.oid) AS definition,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS prosrc_lf_sha256,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.pg_get_functiondef(p.oid),E'\r\n',E'\n'),'UTF8')),'hex') AS definition_lf_sha256,
 p.proacl::text AS explicit_acl,p.proacl IS NULL AS acl_uses_defaults,
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
    'grantor',pg_catalog.pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
    ORDER BY a.grantee,a.grantor,a.privilege_type)
  FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a) AS direct_or_default_acl,
 (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',r.name,'role_exists',r.oid IS NOT NULL,
    'effective_execute',CASE WHEN r.oid IS NOT NULL AND p.oid IS NOT NULL
      THEN pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') END) ORDER BY r.name)
  FROM (SELECT n.name,pr.oid FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) n(name)
        LEFT JOIN pg_catalog.pg_roles pr ON pr.rolname=n.name) r) AS effective_execute
 FROM targets t LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(t.identity)
 LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang
)
SELECT CASE
 WHEN pg_catalog.current_setting('transaction_read_only')<>'on'
   OR current_user='sandbox_exec' OR session_user='sandbox_exec'
 THEN pg_catalog.jsonb_build_object('status','BLOCKED','reason','unapproved role or read-only not enforced')
 ELSE pg_catalog.jsonb_build_object(
  'observation',pg_catalog.jsonb_build_object('statement_utc',pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
   'transaction_utc',pg_catalog.transaction_timestamp() AT TIME ZONE 'UTC','database',pg_catalog.current_database(),
   'current_user',current_user,'session_user',session_user,
   'transaction_read_only',pg_catalog.current_setting('transaction_read_only'),
   'inspection_isolation_only',pg_catalog.current_setting('transaction_isolation'),
   'snapshot',pg_catalog.pg_current_snapshot()::text,'server_version',pg_catalog.current_setting('server_version')),
  'functions',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) ORDER BY f.requested_identity) FROM functions f),'[]'::jsonb),
  'caller_isolation_established',false,
  'route_approval','must be established separately; role/read-only checks alone are insufficient')
 END AS evidence;
