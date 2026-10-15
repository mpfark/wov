-- PREPARATION ONLY: one metadata SELECT; requires approved read-only route.
-- cron.job is scheduling metadata, never job_run_details or gameplay rows.
-- Lack of cron.job visibility is a stop condition; do not work around it.
WITH idle_jobs AS (
 SELECT jobid,jobname,database,username,schedule,active,
 command='SELECT public.idle_shutdown_check();' AS expected_command,
 CASE WHEN command='SELECT public.idle_shutdown_check();' THEN command END AS command
 FROM cron.job WHERE jobname='idle-shutdown-check'
), role_names(name,purpose) AS (
 VALUES ('authenticator','candidate API login, platform confirmation required'),
        ('authenticated','supported gameplay role')
 UNION ALL
 SELECT username,'observed idle job login' FROM idle_jobs
), relevant_roles AS (
 SELECT n.name,pg_catalog.string_agg(DISTINCT n.purpose,'; ' ORDER BY n.purpose) AS purpose,r.oid
 FROM role_names n LEFT JOIN pg_catalog.pg_roles r ON r.rolname=n.name GROUP BY n.name,r.oid
), filtered_settings AS (
 SELECT CASE WHEN s.setdatabase=0 THEN '<all databases>' ELSE d.datname END AS database_scope,
 CASE WHEN s.setrole=0 THEN '<all roles>' ELSE r.rolname END AS role_scope,
 pg_catalog.split_part(k.setting,'=',1) AS key,
 pg_catalog.substr(k.setting,pg_catalog.strpos(k.setting,'=')+1) AS value
 FROM pg_catalog.pg_db_role_setting s LEFT JOIN pg_catalog.pg_database d ON d.oid=s.setdatabase
 LEFT JOIN pg_catalog.pg_roles r ON r.oid=s.setrole
 CROSS JOIN LATERAL pg_catalog.unnest(s.setconfig) k(setting)
 WHERE (s.setdatabase=0 OR d.datname=pg_catalog.current_database()
        OR d.datname IN (SELECT database FROM idle_jobs))
 AND (s.setrole=0 OR s.setrole IN (SELECT oid FROM relevant_roles WHERE oid IS NOT NULL))
 AND pg_catalog.split_part(k.setting,'=',1) IN ('default_transaction_isolation','transaction_isolation',
     'pgrst.db_pre_request','pgrst.db_tx_end','pgrst.db_config')
), cron_privileges AS (
 SELECT r.name,identity,p.oid IS NOT NULL AS function_exists,
 CASE WHEN r.oid IS NOT NULL AND p.oid IS NOT NULL
 THEN pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') END AS effective_execute
 FROM relevant_roles r CROSS JOIN (VALUES
  ('public.idle_shutdown_check()'),('public.combat2_session_access(uuid,uuid)')) t(identity)
 LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(t.identity)
 WHERE r.name IN (SELECT username FROM idle_jobs)
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
   'snapshot',pg_catalog.pg_current_snapshot()::text),
  'idle_jobs',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(j) ORDER BY j.jobid) FROM idle_jobs j),'[]'::jsonb),
  'relevant_roles',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.name) FROM relevant_roles r),'[]'::jsonb),
  'role_database_settings',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.database_scope,s.role_scope,s.key)
    FROM filtered_settings s),'[]'::jsonb),
  'inspection_visible_settings',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',s.name,'setting',s.setting,
    'boot_value',s.boot_val,'reset_value',s.reset_val,'source',s.source)
    ORDER BY s.name) FROM pg_catalog.pg_settings s WHERE s.name IN
    ('default_transaction_isolation','cron.use_background_workers')),'[]'::jsonb),
  'pg_cron',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',e.extname,'version',e.extversion))
    FROM pg_catalog.pg_extension e WHERE e.extname='pg_cron'),'[]'::jsonb),
  'cron_caller_execute',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) ORDER BY c.name,c.identity)
    FROM cron_privileges c),'[]'::jsonb),
  'caller_isolation_established',false,
  'limitations','Catalog defaults and this inspection session do not establish actual RPC/cron transaction isolation; empty job/settings results may be visibility-limited')
 END AS evidence;
