/** Local-only deterministic ACL repair preparation. Never discovers credentials or connects. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export const baseline='491677c891c22f81dab261b7c970dc044ad62bf3';
export const protectedColumns=['str','dex','con','int','wis','cha','level','xp','class','is_classless','unspent_stat_points','respec_points','bhp','bhp_trained','rp_total_earned'];
// Reviewed generated Cloud Row inventory at baseline; never expand dynamically at installation.
export const columns=['ac','active_contract','bhp','bhp_trained','cha','class','combat_trace_enabled','con','contracts_completed','cp','created_at','crown_item_created','current_node_id','dex','family_changed_after_creation','family_id','family_name','gender','gold','hp','id','int','is_classless','king_slayer_at','last_death_at','last_death_log','last_online','level','max_cp','max_hp','max_mp','movement_locked_until','mp','name','portrait_generated_at','portrait_metadata','portrait_url','race','reserved_buffs','respec_points','rp_total_earned','soulforged_item_created','soulring_inventory_id','soulring_tier','stance_state','str','unspent_stat_points','updated_at','user_id','wimp_direction','wimp_hp_threshold','wis','xp'];
export const unprotectedColumns=columns.filter(c=>!protectedColumns.includes(c));
export const browserColumns=['last_online','portrait_generated_at','portrait_metadata','portrait_url','wimp_direction','wimp_hp_threshold'];
export const sqlPath='docs/operations/progression-001F-R1-service-update-repair.sql';
export const manifestPath='docs/operations/progression-001F-R1-manifest.json';
export const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
export const sha=b=>createHash('sha256').update(b).digest('hex');
const arr=a=>`ARRAY[${a.map(c=>`'${c}'`).join(',')}]`;
const authoritySnapshot=`SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'progression_%'),
 'tables',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'progression_%'),
 'triggers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_trigger t WHERE t.tgrelid='public.characters'::regclass))`;
const characterAclSnapshot=`SELECT jsonb_build_object(
 'owner',(SELECT relowner FROM pg_class WHERE oid='public.characters'::regclass),
 'table',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.grantee,a.privilege_type,a.grantor) FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.characters'::regclass AND NOT(a.grantee='service_role'::regrole AND a.privilege_type='UPDATE')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(col.attname,to_jsonb(a)) ORDER BY col.attname,a.grantee,a.privilege_type,a.grantor) FROM pg_attribute col,LATERAL aclexplode(col.attacl) a WHERE col.attrelid='public.characters'::regclass AND NOT(a.grantee='service_role'::regrole AND a.privilege_type='UPDATE')))`;
export function payload(){
 const f=read('docs/operations/progression-001F-cutover.sql');
 const start=f.indexOf('DO $assert$ DECLARE installed record; BEGIN')+'DO $assert$ DECLARE installed record; BEGIN'.length;
 const identity=f.slice(start,f.indexOf(' IF (SELECT enabled FROM public.progression_command_control WHERE singleton)',start));
 if(!identity.includes('001F resulting function identity drift')||identity.includes('DO $assert$'))throw Error('F identity extraction drift');
 const names=['progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal'];
 return `-- ENG-PROGRESSION-001F-R1 PREPARED ONLY; ACL-only forward repair, outside migration discovery.
-- Future migration: progression_001f_r1_restore_unprotected_service_updates.
-- Execute only in a separately authorized standard Drizzle transaction. No key reads or gameplay writes.
LOCK TABLE public.characters IN ACCESS EXCLUSIVE MODE;
DO $repair$ DECLARE installed record; authority_before jsonb; authority_after jsonb;
 other_acl_before jsonb; other_acl_after jsonb; col text;
 expected_columns text[]:=${arr(columns)};
 protected_columns text[]:=${arr(protectedColumns)};
 grant_columns text[]:=${arr(unprotectedColumns)};
BEGIN
 -- A. Exact post-0005 identity and containment, with observed total service UPDATE loss.
${identity}
 IF (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM expected_columns
 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped AND (attgenerated<>'' OR attidentity<>''))
 THEN RAISE EXCEPTION 'R1 characters inventory drift'; END IF;
 IF (SELECT relowner FROM pg_class WHERE oid='public.characters'::regclass)<>'postgres'::regrole
 THEN RAISE EXCEPTION 'R1 character owner drift'; END IF;
 IF cardinality(protected_columns)<>15 OR cardinality(grant_columns)<>38
 OR EXISTS(SELECT 1 FROM unnest(grant_columns) c WHERE c=ANY(protected_columns))
 OR (SELECT array_agg(c ORDER BY c) FROM unnest(protected_columns||grant_columns) c) IS DISTINCT FROM expected_columns
 THEN RAISE EXCEPTION 'R1 partition drift'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(${arr(names)}))<>6
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(${arr(names)}) GROUP BY proname HAVING count(*)<>1)
 OR (SELECT count(*) FROM public.progression_command_control)<>1
 OR NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND enabled=false)
 THEN RAISE EXCEPTION 'R1 command/control drift'; END IF;
 IF has_table_privilege('service_role','public.characters','UPDATE')
 OR has_any_column_privilege('service_role','public.characters','UPDATE')
 THEN RAISE EXCEPTION 'R1 expected service UPDATE loss drift'; END IF;
 IF has_table_privilege('authenticated','public.characters','UPDATE')
 OR NOT has_table_privilege('authenticated','public.characters','SELECT')
 OR EXISTS(SELECT 1 FROM unnest(expected_columns) c WHERE has_column_privilege('authenticated','public.characters',c,'UPDATE') IS DISTINCT FROM (c=ANY(${arr(browserColumns)})))
 THEN RAISE EXCEPTION 'R1 browser preference drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass AND tgname='progression_refuse_raw_progression_write' AND tgenabled='O' AND tgtype=19 AND tgfoid='public.progression_refuse_raw_progression_write()'::regprocedure)
 THEN RAISE EXCEPTION 'R1 fence trigger drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(${arr(names)}) AND (a.grantee<>p.proowner AND (p.proname<>'progression_command' OR a.grantee<>'service_role'::regrole)))
 OR NOT has_function_privilege('service_role','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname<>'postgres' AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(${arr(names)}) AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND (p.proname<>'progression_command' OR r.rolname<>'service_role')))
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
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname NOT IN('postgres','pg_read_all_data','pg_write_all_data') AND
 (has_table_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,REFERENCES')))
 THEN RAISE EXCEPTION 'R1 sidecar/key containment drift'; END IF;
 IF (SELECT array_agg(attname::text||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||attnum::text ORDER BY attname) FROM pg_attribute WHERE attrelid='public.progression_renown_key'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['active:boolean:true:2','key_material:bytea:true:3','key_version:integer:true:1']
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass)<>3
 OR (SELECT count(*) FROM pg_index WHERE indrelid='public.progression_renown_key'::regclass)<>2
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass AND contype='p' AND conkey=ARRAY[1]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass AND convalidated AND pg_get_constraintdef(oid)='CHECK ((key_version > 0))')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_renown_key'::regclass AND convalidated AND pg_get_constraintdef(oid)='CHECK ((octet_length(key_material) = 32))')
 OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.progression_renown_one_active_key'::regclass AND indrelid='public.progression_renown_key'::regclass AND indisunique AND indisvalid AND indkey::text='2' AND pg_get_expr(indpred,indrelid)='active')
 THEN RAISE EXCEPTION 'R1 key metadata drift'; END IF;
 ${authoritySnapshot} INTO authority_before;
 ${characterAclSnapshot} INTO other_acl_before;
 -- B. Table revoke precedes every preservation grant: PostgreSQL clears column UPDATE too.
 REVOKE UPDATE ON public.characters FROM service_role;
 -- C. Protected fields remain explicitly unavailable.
 REVOKE UPDATE(${protectedColumns.join(',')}) ON public.characters FROM service_role;
 -- D. Exact reviewed existing unprotected inventory; never a table UPDATE grant.
 GRANT UPDATE(${unprotectedColumns.join(',')}) ON public.characters TO service_role;
 -- E. Effective privileges, complete partition, and unchanged authority/browser catalogs.
 IF has_table_privilege('service_role','public.characters','UPDATE') THEN RAISE EXCEPTION 'R1 table UPDATE restored'; END IF;
 FOREACH col IN ARRAY protected_columns LOOP
  IF has_column_privilege('service_role','public.characters',col,'UPDATE') THEN RAISE EXCEPTION 'R1 protected UPDATE: %',col; END IF;
 END LOOP;
 FOREACH col IN ARRAY grant_columns LOOP
  IF NOT has_column_privilege('service_role','public.characters',col,'UPDATE') THEN RAISE EXCEPTION 'R1 missing unprotected UPDATE: %',col; END IF;
 END LOOP;
 ${authoritySnapshot} INTO authority_after;
 ${characterAclSnapshot} INTO other_acl_after;
 IF authority_before IS DISTINCT FROM authority_after OR other_acl_before IS DISTINCT FROM other_acl_after
 OR (SELECT count(*) FROM public.progression_command_control)<>1
 OR NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND enabled=false)
 THEN RAISE EXCEPTION 'R1 unrelated authority/control/ACL mutation'; END IF;
END $repair$;
`;
}
export function manifest(){const b=Buffer.from(payload());return {status:'prepared_only',task_start_sha:'b8c18c90b1b5a5532244b76c41568a15986a0cfe',source_baseline:baseline,future_migration:'progression_001f_r1_restore_unprotected_service_updates',inventory_source:'src/integrations/supabase/types.ts characters.Row at source_baseline; historical broad service UPDATE covered all existing columns',protectedColumns,unprotectedColumns,columns,browserColumns,artifact:{path:sqlPath,sha256:sha(b),bytes:b.length,lf_lines:payload().split('\n').length-1},files:['.gitattributes','scripts/prepare-progression-001F-R1.mjs','scripts/progression-001F-R1-sql.test.mjs'].map(path=>({path,sha256:sha(read(path))}))};}
export function check(){
 if(read(sqlPath)!==payload()||read(manifestPath)!==JSON.stringify(manifest(),null,2)+'\n')throw Error('R1 generator/manifest drift');
 for(const path of [sqlPath,manifestPath,'scripts/prepare-progression-001F-R1.mjs','scripts/progression-001F-R1-sql.test.mjs']){const b=readFileSync(path);if(b.includes(13)||b.subarray(0,3).equals(Buffer.from([239,187,191])))throw Error('R1 UTF-8/LF encoding drift: '+path);}
 const row=read('src/integrations/supabase/types.ts').match(/      characters: \{\n        Row: \{([\s\S]*?)\n        \}/)[1];
 const inventory=[...row.matchAll(/^          (\w+):/gm)].map(m=>m[1]).sort();
 if(JSON.stringify(inventory)!==JSON.stringify(columns))throw Error('R1 source inventory drift');
 const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
 if(git('diff',baseline,'--','drizzle','supabase/migrations','src/integrations/supabase/types.ts').trim())throw Error('R1 installation history/type preservation drift');
 if(git('status','--porcelain','--','drizzle','supabase/migrations','src/integrations/supabase/types.ts').trim())throw Error('R1 discovery/history/type worktree drift');
 if(git('diff',baseline,'--','src','supabase/functions').trim())throw Error('R1 runtime preservation drift');
 for(const path of ['docs/operations/progression-001F-cutover.sql','docs/operations/progression-001F-manifest.json','scripts/prepare-progression-001F.mjs','scripts/progression-001F-authority.sql'])if(git('diff',baseline,'--',path).trim())throw Error('R1 historical F artifact drift');
 const installed=git('show',`${baseline}:drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql`);
 if(sha(installed)!=='c5c3c05341a7fc42678326d9572ed1442f04579e568d228b4d89f5eb811e18ff')throw Error('0005 installed identity mismatch');
 console.log(JSON.stringify(manifest().artifact));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.includes('--write')){writeFileSync(sqlPath,payload());writeFileSync(manifestPath,JSON.stringify(manifest(),null,2)+'\n');}else check();}
