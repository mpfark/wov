-- ENG-PROGRESSION-001F-R1 PREPARED ONLY; ACL-only forward repair, outside migration discovery.
-- Future migration: progression_001f_r1_restore_unprotected_service_updates.
-- Execute only in a separately authorized standard Drizzle transaction. No key reads or gameplay writes.
LOCK TABLE public.characters IN ACCESS EXCLUSIVE MODE;
DO $repair$ DECLARE installed record; authority_before jsonb; authority_after jsonb;
 other_acl_before jsonb; other_acl_after jsonb; col text;
 expected_columns text[]:=ARRAY['ac','active_contract','bhp','bhp_trained','cha','class','combat_trace_enabled','con','contracts_completed','cp','created_at','crown_item_created','current_node_id','dex','family_changed_after_creation','family_id','family_name','gender','gold','hp','id','int','is_classless','king_slayer_at','last_death_at','last_death_log','last_online','level','max_cp','max_hp','max_mp','movement_locked_until','mp','name','portrait_generated_at','portrait_metadata','portrait_url','race','reserved_buffs','respec_points','rp_total_earned','soulforged_item_created','soulring_inventory_id','soulring_tier','stance_state','str','unspent_stat_points','updated_at','user_id','wimp_direction','wimp_hp_threshold','wis','xp'];
 protected_columns text[]:=ARRAY['str','dex','con','int','wis','cha','level','xp','class','is_classless','unspent_stat_points','respec_points','bhp','bhp_trained','rp_total_earned'];
 grant_columns text[]:=ARRAY['ac','active_contract','combat_trace_enabled','contracts_completed','cp','created_at','crown_item_created','current_node_id','family_changed_after_creation','family_id','family_name','gender','gold','hp','id','king_slayer_at','last_death_at','last_death_log','last_online','max_cp','max_hp','max_mp','movement_locked_until','mp','name','portrait_generated_at','portrait_metadata','portrait_url','race','reserved_buffs','soulforged_item_created','soulring_inventory_id','soulring_tier','stance_state','updated_at','user_id','wimp_direction','wimp_hp_threshold'];
BEGIN
 -- A. Exact post-0005 identity and containment, with observed total service UPDATE loss.

 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_validate_fresh_internal(uuid,numeric,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'036cc182e27ca11b58841bd1e1b90e026ed5344015519d1333102606588d9c5f'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_expected_version','_operation']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_validate_fresh_internal(uuid,numeric,text)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0026d856625b09bea510d291e563ce05530baf9690d845cad244ea7199fc4494'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_actor','_request','_expected_version','_operation','_stat','_normalized']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_renown_draw_internal(uuid,uuid,text,numeric,numeric)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'b820e6e27ab3b748e888a392915563f772c907823493a2617d32266204f1c0d7'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_request','_stat','_version','_rank']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_renown_draw_internal(uuid,uuid,text,numeric,numeric)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'0e165e22a469dbdf7c65e2cc15a778cf358b1f77da8079ce30fc0d42f5863382'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>3
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM 'NULL::jsonb, NULL::text, NULL::text'
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character','_actor','_request','_expected_version','_operation','_allocations','_target_class','_stat']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_refuse_raw_progression_write()'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'cfbe32e43079c64328b397238cae0e7033e24de6ae2df4571ee40e6a62a6037a'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM false
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'trigger'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'v'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM NULL::text[]
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_refuse_raw_progression_write()'; END IF;
 SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.progression_command_projection_internal(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')<>'4ea3f550ed6260a0045540ad693977ba97f650c0139076700770d6dbe6bf3e26'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM true
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'jsonb'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'s'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>0
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM NULL::text
 OR installed.proargnames IS DISTINCT FROM ARRAY['_character']
 THEN RAISE EXCEPTION '001F resulting function identity drift: progression_command_projection_internal(uuid)'; END IF;

 IF (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM expected_columns
 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped AND (attgenerated<>'' OR attidentity<>''))
 THEN RAISE EXCEPTION 'R1 characters inventory drift'; END IF;
 IF (SELECT relowner FROM pg_class WHERE oid='public.characters'::regclass)<>'postgres'::regrole
 THEN RAISE EXCEPTION 'R1 character owner drift'; END IF;
 IF cardinality(protected_columns)<>15 OR cardinality(grant_columns)<>38
 OR EXISTS(SELECT 1 FROM unnest(grant_columns) c WHERE c=ANY(protected_columns))
 OR (SELECT array_agg(c ORDER BY c) FROM unnest(protected_columns||grant_columns) c) IS DISTINCT FROM expected_columns
 THEN RAISE EXCEPTION 'R1 partition drift'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal']))<>6
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal']) GROUP BY proname HAVING count(*)<>1)
 OR (SELECT count(*) FROM public.progression_command_control)<>1
 OR NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND enabled=false)
 THEN RAISE EXCEPTION 'R1 command/control drift'; END IF;
 IF has_table_privilege('service_role','public.characters','UPDATE')
 OR has_any_column_privilege('service_role','public.characters','UPDATE')
 THEN RAISE EXCEPTION 'R1 expected service UPDATE loss drift'; END IF;
 IF has_table_privilege('authenticated','public.characters','UPDATE')
 OR NOT has_table_privilege('authenticated','public.characters','SELECT')
 OR EXISTS(SELECT 1 FROM unnest(expected_columns) c WHERE has_column_privilege('authenticated','public.characters',c,'UPDATE') IS DISTINCT FROM (c=ANY(ARRAY['last_online','portrait_generated_at','portrait_metadata','portrait_url','wimp_direction','wimp_hp_threshold'])))
 THEN RAISE EXCEPTION 'R1 browser preference drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass AND tgname='progression_refuse_raw_progression_write' AND tgenabled='O' AND tgtype=19 AND tgfoid='public.progression_refuse_raw_progression_write()'::regprocedure)
 THEN RAISE EXCEPTION 'R1 fence trigger drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY['progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal']) AND (a.grantee<>p.proowner AND (p.proname<>'progression_command' OR a.grantee<>'service_role'::regrole)))
 OR NOT has_function_privilege('service_role','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname<>'postgres' AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY['progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal']) AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND (p.proname<>'progression_command' OR r.rolname<>'service_role')))
 THEN RAISE EXCEPTION 'R1 function ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname<>'postgres'
 AND has_function_privilege(r.oid,'public.train_renown_stat(uuid,text)','EXECUTE'))
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_receipt'::regclass
 AND conname='progression_receipt_operation_check' AND convalidated
 AND pg_get_constraintdef(oid)='CHECK ((operation = ANY (ARRAY[''xp''::text, ''permanent''::text, ''order''::text, ''respec''::text, ''renown''::text])))')
 THEN RAISE EXCEPTION 'R1 legacy Renown/receipt drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN('public.progression_renown_key'::regclass,'public.progression_character_state'::regclass,'public.progression_receipt'::regclass,'public.progression_class_growth_milestone'::regclass,'public.progression_respec_milestone'::regclass,'public.progression_command_control'::regclass)
 AND (c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col,LATERAL aclexplode(col.attacl) a WHERE col.attrelid=c.oid AND a.grantee<>c.relowner)))
 -- 001E-R1 precedent: administrative global capabilities are not direct object ACL leaks.
 -- Gameplay/application members are never exempt, including superuser/BYPASSRLS/global authority.
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname<>'postgres'
 AND (r.rolname IN('anon','authenticated','service_role')
  OR EXISTS(WITH RECURSIVE application_members(oid) AS (
   SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated','service_role')
   UNION SELECT membership.member FROM pg_auth_members membership JOIN application_members application ON membership.roleid=application.oid)
   SELECT 1 FROM application_members WHERE oid=r.oid)
  OR (NOT r.rolsuper AND NOT r.rolbypassrls AND NOT EXISTS(
   SELECT 1 FROM pg_roles authority WHERE authority.rolname IN('pg_read_all_data','pg_write_all_data') AND pg_has_role(r.oid,authority.oid,'USAGE'))))
 AND (has_table_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR has_any_column_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,REFERENCES')))
 THEN RAISE EXCEPTION 'R1 sidecar/key containment drift'; END IF;
 IF (SELECT array_agg(attname::text||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||attnum::text ORDER BY attname) FROM pg_attribute WHERE attrelid='public.progression_renown_key'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['active:boolean:true:2','key_material:bytea:true:3','key_version:integer:true:1']
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass)<>3
 OR (SELECT count(*) FROM pg_index WHERE indrelid='public.progression_renown_key'::regclass)<>2
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass AND convalidated AND pg_get_constraintdef(oid)='CHECK ((key_version > 0))')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass AND convalidated AND pg_get_constraintdef(oid)='CHECK ((octet_length(key_material) = 32))')
 OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.progression_renown_one_active_key'::regclass AND indrelid='public.progression_renown_key'::regclass AND indisunique AND indisvalid AND indkey::text='2' AND pg_get_expr(indpred,indrelid)='active')
 THEN RAISE EXCEPTION 'R1 key metadata drift'; END IF;
 SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'progression_%'),
 'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid='public.characters'::regclass)) INTO authority_before;
 SELECT jsonb_build_object(
 'owner',(SELECT relowner FROM pg_class WHERE oid='public.characters'::regclass),
 'table',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.privilege_type,a.grantor) FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.characters'::regclass AND NOT(a.grantee='service_role'::regrole AND a.privilege_type='UPDATE')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(col.attname,to_jsonb(a)) ORDER BY col.attname,a.grantee,a.privilege_type,a.grantor) FROM pg_attribute col,LATERAL aclexplode(col.attacl) a WHERE col.attrelid='public.characters'::regclass AND NOT(a.grantee='service_role'::regrole AND a.privilege_type='UPDATE'))) INTO other_acl_before;
 -- B. Table revoke precedes every preservation grant: PostgreSQL clears column UPDATE too.
 REVOKE UPDATE ON public.characters FROM service_role;
 -- C. Protected fields remain explicitly unavailable.
 REVOKE UPDATE(str,dex,con,int,wis,cha,level,xp,class,is_classless,unspent_stat_points,respec_points,bhp,bhp_trained,rp_total_earned) ON public.characters FROM service_role;
 -- D. Exact reviewed existing unprotected inventory; never a table UPDATE grant.
 GRANT UPDATE(ac,active_contract,combat_trace_enabled,contracts_completed,cp,created_at,crown_item_created,current_node_id,family_changed_after_creation,family_id,family_name,gender,gold,hp,id,king_slayer_at,last_death_at,last_death_log,last_online,max_cp,max_hp,max_mp,movement_locked_until,mp,name,portrait_generated_at,portrait_metadata,portrait_url,race,reserved_buffs,soulforged_item_created,soulring_inventory_id,soulring_tier,stance_state,updated_at,user_id,wimp_direction,wimp_hp_threshold) ON public.characters TO service_role;
 -- E. Effective privileges, complete partition, and unchanged authority/browser catalogs.
 IF has_table_privilege('service_role','public.characters','UPDATE') THEN RAISE EXCEPTION 'R1 table UPDATE restored'; END IF;
 FOREACH col IN ARRAY protected_columns LOOP
  IF has_column_privilege('service_role','public.characters',col,'UPDATE') THEN RAISE EXCEPTION 'R1 protected UPDATE: %',col; END IF;
 END LOOP;
 FOREACH col IN ARRAY grant_columns LOOP
  IF NOT has_column_privilege('service_role','public.characters',col,'UPDATE') THEN RAISE EXCEPTION 'R1 missing unprotected UPDATE: %',col; END IF;
 END LOOP;
 SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'progression_%'),
 'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid='public.characters'::regclass)) INTO authority_after;
 SELECT jsonb_build_object(
 'owner',(SELECT relowner FROM pg_class WHERE oid='public.characters'::regclass),
 'table',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.privilege_type,a.grantor) FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.characters'::regclass AND NOT(a.grantee='service_role'::regrole AND a.privilege_type='UPDATE')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(col.attname,to_jsonb(a)) ORDER BY col.attname,a.grantee,a.privilege_type,a.grantor) FROM pg_attribute col,LATERAL aclexplode(col.attacl) a WHERE col.attrelid='public.characters'::regclass AND NOT(a.grantee='service_role'::regrole AND a.privilege_type='UPDATE'))) INTO other_acl_after;
 IF authority_before IS DISTINCT FROM authority_after OR other_acl_before IS DISTINCT FROM other_acl_after
 OR (SELECT count(*) FROM public.progression_command_control)<>1
 OR NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND enabled=false)
 THEN RAISE EXCEPTION 'R1 unrelated authority/control/ACL mutation'; END IF;
END $repair$;
