-- ENG-LEGACY-001C3. One SELECT statement / one observation snapshot.
-- Metadata only. NOT executed locally or against hosted Supabase.
WITH requested_functions(identity) AS (VALUES
 ('public.sync_character_resources(uuid)'),
 ('public.character_sync_derived_internal(uuid,boolean,boolean)'),
 ('public.character_inventory_action(uuid,text,uuid,text,uuid)'),
 ('public.character_repair(uuid,text,uuid,uuid)'),
 ('public.restrict_party_leader_updates()')),
requested_tables(identity) AS (VALUES ('public.characters'),('public.character_inventory')),
function_metadata AS (
 SELECT r.identity AS requested_identity,p.oid IS NOT NULL AS exists,
 p.oid::regprocedure::text AS installed_identity,
 pg_get_function_identity_arguments(p.oid) AS identity_arguments,
 pg_get_function_arguments(p.oid) AS arguments_with_defaults,
 pg_get_function_result(p.oid) AS result_type,p.proretset AS returns_set,
 pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,
 p.prosecdef AS security_definer,p.provolatile AS volatility,p.proconfig AS settings,
 encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS normalized_prosrc_sha256,
 pg_get_functiondef(p.oid) AS definition,p.proacl AS direct_acl,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable))
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS acl_entries,
 (SELECT jsonb_agg(jsonb_build_object('role',q.rolname,'superuser',q.rolsuper,
 'effective_execute',has_function_privilege(q.oid,p.oid,'EXECUTE')) ORDER BY q.rolname)
 FROM pg_roles q WHERE q.rolname IN ('anon','authenticated','service_role')) AS effective_execute,
 (SELECT jsonb_agg(q.rolname ORDER BY q.rolname) FROM pg_roles q
 WHERE q.rolname IN ('anon','authenticated','service_role')) AS roles_visible
 FROM requested_functions r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.identity)
 LEFT JOIN pg_language l ON l.oid=p.prolang
), table_metadata AS (
 SELECT r.identity AS requested_identity,c.oid IS NOT NULL AS exists,
 c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity
 FROM requested_tables r LEFT JOIN pg_class c ON c.oid=to_regclass(r.identity)
), trigger_metadata AS (
 SELECT c.oid::regclass::text AS table_identity,t.tgname,t.tgenabled AS enabled_state,
 t.tgconstraint<>0 AS constraint_trigger,t.tgdeferrable,t.tginitdeferred,
 pg_get_triggerdef(t.oid,true) AS trigger_definition,t.tgfoid::regprocedure::text AS function_identity,
 pg_get_userbyid(p.proowner) AS function_owner,p.prosecdef AS security_definer,p.proconfig AS settings,
 encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') AS normalized_prosrc_sha256,
 pg_get_functiondef(p.oid) AS function_definition
 FROM requested_tables r JOIN pg_class c ON c.oid=to_regclass(r.identity)
 JOIN pg_trigger t ON t.tgrelid=c.oid AND NOT t.tgisinternal
 JOIN pg_proc p ON p.oid=t.tgfoid
), column_metadata AS (
 SELECT c.oid::regclass::text AS table_identity,a.attname,
 format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression
 FROM requested_tables r JOIN pg_class c ON c.oid=to_regclass(r.identity)
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE (r.identity='public.characters' AND a.attname IN
 ('id','user_id','race','class','is_classless','level','str','dex','con','int','wis','cha',
 'hp','cp','mp','max_hp','max_cp','max_mp','ac','deleted_at','restore_until','lifecycle_version','updated_at'))
 OR (r.identity='public.character_inventory' AND a.attname IN
 ('id','character_id','item_id','equipped_slot','current_durability','stat_override','applied_gems','crafted_level','updated_at'))
), constraint_metadata AS (
 SELECT c.conrelid::regclass::text AS table_identity,c.conname,c.contype,c.convalidated,
 c.condeferrable,c.condeferred,pg_get_constraintdef(c.oid,true) AS definition
 FROM requested_tables r JOIN pg_constraint c ON c.conrelid=to_regclass(r.identity)
), isolation_role_settings AS (
 SELECT CASE WHEN s.setrole=0 THEN 'ALL' ELSE pg_get_userbyid(s.setrole) END AS role_scope,
 CASE WHEN s.setdatabase=0 THEN 'ALL' ELSE d.datname END AS database_scope,v.setting
 FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase
 CROSS JOIN LATERAL unnest(s.setconfig) v(setting)
 WHERE (s.setdatabase=0 OR d.datname=current_database())
 AND (s.setrole=0 OR s.setrole IN (SELECT oid FROM pg_roles
 WHERE rolname IN ('anon','authenticated','service_role','authenticator',current_user,session_user)))
 AND split_part(v.setting,'=',1) IN ('default_transaction_isolation','transaction_isolation')
)
SELECT jsonb_build_object(
 'observation',jsonb_build_object('statement_time',statement_timestamp(),'transaction_time',transaction_timestamp(),
 'inspection_role',current_user,'session_role',session_user,'server_version',current_setting('server_version'),
 'snapshot',pg_current_snapshot()::text,'transaction_isolation',current_setting('transaction_isolation'),
 'transaction_read_only',current_setting('transaction_read_only'),'default_transaction_isolation',current_setting('default_transaction_isolation')),
 'functions',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY requested_identity) FROM function_metadata f),'[]'::jsonb),
 'tables',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY requested_identity) FROM table_metadata t),'[]'::jsonb),
 'triggers',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY table_identity,tgname) FROM trigger_metadata t),'[]'::jsonb),
 'columns',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY table_identity,attname) FROM column_metadata c),'[]'::jsonb),
 'constraints',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY table_identity,conname) FROM constraint_metadata c),'[]'::jsonb),
 'isolation_role_settings',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY role_scope,database_scope,setting) FROM isolation_role_settings s),'[]'::jsonb),
 'isolation_server_settings',coalesce((SELECT jsonb_agg(jsonb_build_object('name',name,'setting',setting,'reset_value',reset_val,'source',source) ORDER BY name)
 FROM pg_settings WHERE name IN ('default_transaction_isolation','transaction_isolation')),'[]'::jsonb)
) AS resource_sync_preflight;
