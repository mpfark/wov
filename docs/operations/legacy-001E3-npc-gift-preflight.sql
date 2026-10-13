-- ENG-LEGACY-001E3: metadata only, NOT EXECUTED. No gameplay rows or function calls.
-- First statement is one observation snapshot; runner history is separately observed.
WITH requested_tables(identity) AS (VALUES
 ('public.characters'),('public.npcs'),('public.items'),('public.character_npc_gifts'),
 ('public.character_inventory'),('public.unique_item_instance')),
tables AS (SELECT r.identity,c.oid,c.relowner,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 FROM requested_tables r LEFT JOIN pg_class c ON c.oid=to_regclass(r.identity)),
triggers AS (SELECT t.*,c.identity FROM tables c JOIN pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal),
functions AS (SELECT to_regprocedure('public.grant_npc_gift(uuid,uuid,uuid,boolean)')::oid AS oid
 UNION SELECT tgfoid FROM triggers),
function_metadata AS (
 SELECT p.oid::regprocedure::text AS identity,pg_get_function_arguments(p.oid) AS arguments_with_defaults,
 pg_get_function_result(p.oid) AS result_type,pg_get_userbyid(p.proowner) AS owner,
 l.lanname AS language,p.prosecdef AS security_definer,p.proconfig AS settings,p.provolatile,
 pg_get_functiondef(p.oid) AS definition,
 encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS normalized_prosrc_sha256,
 encode(sha256(convert_to(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),'UTF8')),'hex') AS normalized_definition_sha256,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable))
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS direct_acl,
 (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'superuser',r.rolsuper,
 'effective_execute',has_function_privilege(r.oid,p.oid,'EXECUTE')) ORDER BY r.rolname)
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres')) AS effective_execute
 FROM functions f JOIN pg_proc p ON p.oid=f.oid JOIN pg_language l ON l.oid=p.prolang),
table_metadata AS (
 SELECT c.identity,c.oid IS NOT NULL AS exists,c.relkind,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity,c.relforcerowsecurity,row_security_active(c.oid) AS inspection_role_rls_active,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 'privilege',a.privilege_type,'grantor',pg_get_userbyid(a.grantor),'grantable',a.is_grantable))
 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a) AS direct_acl,
 (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'select',has_table_privilege(r.oid,c.oid,'SELECT'),
 'insert',has_table_privilege(r.oid,c.oid,'INSERT'),'update',has_table_privilege(r.oid,c.oid,'UPDATE'),
 'delete',has_table_privilege(r.oid,c.oid,'DELETE'),'bypass_rls',r.rolbypassrls) ORDER BY r.rolname)
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres')) AS effective_access
 FROM tables c),
columns AS (SELECT c.identity,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression,
 (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'insert',has_column_privilege(r.oid,c.oid,a.attnum,'INSERT'),
 'update',has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE')) ORDER BY r.rolname)
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')) AS effective_column_writes
 FROM tables c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum),
constraints AS (SELECT c.identity,k.conname,k.contype,pg_get_constraintdef(k.oid,true) AS definition,
 k.condeferrable,k.condeferred,k.convalidated FROM tables c JOIN pg_constraint k ON k.conrelid=c.oid),
indexes AS (SELECT c.identity,i.indexrelid::regclass::text AS identity_index,pg_get_indexdef(i.indexrelid) AS definition,
 i.indisunique,i.indisvalid,i.indisready FROM tables c JOIN pg_index i ON i.indrelid=c.oid),
policies AS (SELECT c.identity,p.polname,p.polcmd,p.polpermissive,
 ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END FROM unnest(p.polroles) role_oid) AS roles,
 pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
 FROM tables c JOIN pg_policy p ON p.polrelid=c.oid),
trigger_metadata AS (SELECT identity,tgname,tgenabled,tgconstraint<>0 AS constraint_trigger,tgdeferrable,tginitdeferred,
 tgfoid::regprocedure::text AS bound_function,pg_get_triggerdef(oid,true) AS definition FROM triggers)
SELECT statement_timestamp() AS observed_at,current_user AS inspection_role,pg_current_snapshot()::text AS snapshot,
 'public.grant_npc_gift(uuid,uuid,uuid,boolean)' AS requested_function,
 to_regprocedure('public.grant_npc_gift(uuid,uuid,uuid,boolean)') IS NOT NULL AS gift_exists,
 '9e5c246bb43d458ef7256ba931524178389171a2ce12ffeee9ea0a3dbfaa003b' AS expected_source_prosrc_sha256,
 (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.identity) FROM function_metadata f) AS functions,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.identity) FROM table_metadata t) AS tables,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.identity,c.attname) FROM columns c) AS columns,
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.identity,c.conname) FROM constraints c) AS constraints,
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.identity,i.identity_index) FROM indexes i) AS indexes,
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.identity,p.polname) FROM policies p) AS policies,
 (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.identity,t.tgname) FROM trigger_metadata t) AS triggers,
 (SELECT jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'direct_acl',n.nspacl,
 'effective_roles',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'usage',has_schema_privilege(r.oid,n.oid,'USAGE'),
 'create',has_schema_privilege(r.oid,n.oid,'CREATE'))) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres')))
 FROM pg_namespace n WHERE n.nspname='public') AS public_schema_authority;

-- Separate statement snapshot: runner metadata only, never Supabase-history repair.
SELECT statement_timestamp() AS observed_at,current_user AS inspection_role,pg_current_snapshot()::text AS snapshot,
 id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY id;
