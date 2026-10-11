-- ENG-LEGACY-001B4: metadata only; do not invoke any gameplay function.
-- Prepared locally, NOT executed. Return all result sets without truncation.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT statement_timestamp() AS observed_at, current_user AS inspection_role,
       session_user, current_setting('server_version') AS server_version;

-- Missing identities remain visible rather than disappearing from an inner join.
WITH requested(identity) AS (VALUES
 ('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'),
 ('public.combat2_refuse_invalid_stance_class_change()'),
 ('public.combat2_refuse_invalid_stance_equipment_change()'),
 ('public.character_lifecycle_character_fence()'),
 ('public.character_lifecycle_child_fence()'))
SELECT r.identity AS requested_identity,p.oid IS NOT NULL AS exists,
 p.oid::regprocedure::text AS installed_identity,
 pg_get_function_identity_arguments(p.oid) AS identity_arguments,
 pg_get_function_result(p.oid) AS result_type,pg_get_userbyid(p.proowner) AS owner,
 l.lanname AS language,p.prosecdef AS security_definer,p.provolatile AS volatility,
 p.proconfig AS settings,p.proacl AS direct_acl,
 encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS normalized_prosrc_sha256,
 pg_get_functiondef(p.oid) AS definition,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
   'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable))
  FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS acl_entries,
 (SELECT jsonb_agg(jsonb_build_object('role',q.rolname,'superuser',q.rolsuper,
   'effective_execute',has_function_privilege(q.oid,p.oid,'EXECUTE')) ORDER BY q.rolname)
  FROM pg_roles q WHERE q.rolname IN ('anon','authenticated','service_role','postgres')) AS effective_execute
FROM requested r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.identity)
LEFT JOIN pg_language l ON l.oid=p.prolang ORDER BY r.identity;

-- Direct stance fences and lifecycle boundaries, plus unexpected triggers on
-- these exact dependency tables. No rows from these gameplay tables are read.
WITH requested(identity) AS (VALUES ('public.character_stance'),('public.character_stance_request'),
 ('public.node_fighter'),('public.node_encounter'),('public.characters'),('public.character_inventory'))
SELECT r.identity AS requested_table,c.oid IS NOT NULL AS table_exists,
 t.tgname,t.tgenabled AS enabled_state,t.tgisinternal AS internal_trigger,
 pg_get_triggerdef(t.oid,true) AS trigger_definition,t.tgfoid::regprocedure::text AS trigger_function,
 pg_get_userbyid(p.proowner) AS function_owner,p.prosecdef AS security_definer,p.proconfig AS settings,
 CASE WHEN t.tgname IN ('character_lifecycle_child_fence','character_lifecycle_character_fence',
 'combat2_refuse_invalid_stance_class_change','combat2_refuse_invalid_stance_equipment_change')
 THEN pg_get_functiondef(p.oid) END AS relevant_trigger_function_definition
FROM requested r LEFT JOIN pg_class c ON c.oid=to_regclass(r.identity)
LEFT JOIN pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal
LEFT JOIN pg_proc p ON p.oid=t.tgfoid ORDER BY r.identity,t.tgname;

-- Only columns/constraints used by membership and row locking.
SELECT c.oid::regclass::text AS table_identity,pg_get_userbyid(c.relowner) AS owner,
 c.relkind,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE (c.oid=to_regclass('public.node_encounter') AND a.attname IN ('id','node_id'))
 OR (c.oid=to_regclass('public.node_fighter') AND a.attname IN ('id','encounter_id','character_id','present'))
ORDER BY table_identity,a.attnum;
SELECT conrelid::regclass::text AS table_identity,conname,contype,convalidated,
 pg_get_constraintdef(oid,true) AS definition
FROM pg_constraint WHERE conrelid IN (to_regclass('public.node_encounter'),to_regclass('public.node_fighter'))
 AND contype IN ('p','u','f') ORDER BY table_identity,conname;

-- Runner history only; compare with the published source journal and SQL hashes.
-- If this relation is unavailable, stop and report; do not use a migration tool
-- or query/repair the historical Supabase ledger as a fallback.
SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id;
COMMIT;
