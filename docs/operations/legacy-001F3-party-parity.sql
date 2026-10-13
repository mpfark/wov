-- ENG-LEGACY-001F3: one metadata SELECT, one statement snapshot.
-- No gameplay rows, gameplay-function calls, transactions, DDL or mutation.
WITH requested_functions(identity) AS (VALUES
 ('public.party_mutate(uuid,text,uuid,uuid,uuid,uuid)'),
 ('public.party_combat_mutation_blocked(uuid,uuid)'),
 ('public.party_operation_finish(uuid,jsonb)'),
 ('public.combat_enter(uuid,uuid)'),
 ('public.combat_enter_without_engagement_gate(uuid,uuid)'),
 ('public.combat_enter_without_canary_gate(uuid,uuid)'),
 ('public.combat2_hostile_action(uuid,text,text,uuid,uuid)'),
 ('public.node_tick_claim(uuid,integer)'),
 ('public.node_tick_claim_without_character_stances(uuid,integer)'),
 ('public.node_tick_claim_without_boss_timing(uuid,integer)'),
 ('public.node_tick_claim_without_canary_gate(uuid,integer)'),
 ('public.combat2_party_depart(uuid,uuid,uuid)'),
 ('public.combat2_party_depart_without_immediate_transition(uuid,uuid,uuid)'),
 ('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'),
 ('public.combat2_finish_immediate_party_departure(uuid)'),
 ('public.combat2_depart(uuid,uuid,uuid)'),
 ('public.combat2_depart_without_immediate_transition(uuid,uuid,uuid)'),
 ('public.combat2_depart_without_canary_gate(uuid,uuid,uuid)'),
 ('public.combat2_finish_immediate_departure(uuid)'),
 ('public.combat2_arrive_after_relocation(uuid,uuid)'),
 ('public.combat2_authoritative_arrival_trigger()'),
 ('public.character_lifecycle_child_fence()'),
 ('public.combat2_party_departure_finalize()'),
 ('public.combat2_refresh_tanks(uuid)'),
 ('public.combat2_validate_party_tank()'),
 ('public.combat2_party_tank_changed()'),
 ('public.combat2_fighter_presence_changed()')),
requested_tables(identity) AS (VALUES
 ('public.characters'),('public.parties'),('public.party_members'),
 ('public.party_operation_request'),('public.node_encounter'),
 ('public.node_fighter'),('public.node_arrival_group'),
 ('public.combat2_departure_request'),('public.combat2_party_departure_request'),
 ('public.combat2_party_departure_member')),
tables AS (SELECT r.identity,c.oid,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
 FROM requested_tables r LEFT JOIN pg_class c ON c.oid=to_regclass(r.identity)),
triggers AS (SELECT x.identity,t.* FROM tables x JOIN pg_trigger t ON t.tgrelid=x.oid WHERE NOT t.tgisinternal),
function_ids AS (
 SELECT r.identity,p.oid FROM requested_functions r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.identity)
 UNION SELECT DISTINCT p.oid::regprocedure::text,p.oid FROM triggers t JOIN pg_proc p ON p.oid=t.tgfoid),
functions AS (SELECT f.identity AS requested_identity,p.oid IS NOT NULL AS present,
 p.oid::regprocedure::text AS installed_identity,pg_get_function_identity_arguments(p.oid) AS signature,
 pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS security_definer,p.provolatile AS volatility,
 p.proconfig AS settings,pg_get_functiondef(p.oid) AS definition,
 encode(sha256(convert_to(regexp_replace(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),'[[:space:]]+',' ','g'),'UTF8')),'hex') AS normalized_definition_sha256,
 p.proacl AS explicit_acl,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable))
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS direct_acl,
 (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'superuser',r.rolsuper,
 'execute',has_function_privilege(r.oid,p.oid,'EXECUTE')) ORDER BY r.rolname)
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres')) AS effective_execute
 FROM function_ids f LEFT JOIN pg_proc p ON p.oid=f.oid),
table_metadata AS (SELECT x.identity,x.oid IS NOT NULL AS present,pg_get_userbyid(x.relowner) AS owner,
 x.relrowsecurity AS rls,x.relforcerowsecurity AS force_rls,x.relacl AS explicit_acl,
 (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'select',has_table_privilege(r.oid,x.oid,'SELECT'),
 'insert',has_table_privilege(r.oid,x.oid,'INSERT'),'update',has_table_privilege(r.oid,x.oid,'UPDATE'),
 'delete',has_table_privilege(r.oid,x.oid,'DELETE')) ORDER BY r.rolname)
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres')) AS effective_privileges,
 (SELECT jsonb_agg(jsonb_build_object('name',c.conname,'type',c.contype,'definition',pg_get_constraintdef(c.oid,true),
 'deferrable',c.condeferrable,'deferred',c.condeferred,'validated',c.convalidated) ORDER BY c.conname)
 FROM pg_constraint c WHERE c.conrelid=x.oid) AS constraints,
 (SELECT jsonb_agg(jsonb_build_object('name',i.indexrelid::regclass::text,'valid',i.indisvalid,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid)
 FROM pg_index i WHERE i.indrelid=x.oid) AS indexes,
 (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'roles',p.polroles,
 'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
 FROM pg_policy p WHERE p.polrelid=x.oid) AS policies
 FROM tables x)
SELECT jsonb_build_object(
 'observation',jsonb_build_object('statement_time',statement_timestamp(),'role',current_user,
 'server_version',current_setting('server_version'),'transaction_isolation',current_setting('transaction_isolation'),
 'default_transaction_isolation',current_setting('default_transaction_isolation'),
 'transaction_read_only',current_setting('transaction_read_only')),
 'functions',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.requested_identity) FROM functions f),
 'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.identity) FROM table_metadata t),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.identity,'name',t.tgname,'enabled',t.tgenabled,
 'constraint_trigger',t.tgconstraint<>0,'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,
 'function',t.tgfoid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) ORDER BY t.identity,t.tgname) FROM triggers t)
) AS party_combat_parity;
