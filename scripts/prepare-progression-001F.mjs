/** Deterministic forward preparation only; never connects to hosted PostgreSQL. */
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {read,sha,definition,xpDefinition,dependencies} from './prepare-progression-001E.mjs';
const e=read('scripts/progression-001E-commands.sql');
const stats=['str','dex','con','int','wis','cha'];
function once(s,a,b){if(s.split(a).length!==2)throw Error('F anchor cardinality: '+a);return s.replace(a,()=>b);}
function defaults(sql){
 const args=sql.match(/\(([\s\S]*?)\)\s*RETURNS/i)[1].split(',');
 const expressions=args.flatMap(arg=>{
  const match=arg.match(/\bDEFAULT\s+(.+)$/i);if(!match)return [];
  const type=arg.trim().split(/\s+/)[1],value=match[1].trim();
  return [/^null$/i.test(value)?`NULL::${type}`:/^(true|false)$/i.test(value)?value.toLowerCase():value];
 });
 return expressions.length?`'${expressions.join(', ').replaceAll("'","''")}'`:'NULL::text';
}
function expandedCommand(){
 let s=definition(e,'progression_command').sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 s=once(s,'_target_class text DEFAULT NULL)','_target_class text DEFAULT NULL,_stat text DEFAULT NULL)');
 s=once(s,"NOT IN('allocate','join','switch')","NOT IN('allocate','join','switch','respec','renown')");
 s=once(s," IF _operation='allocate' THEN\n  IF _target_class IS NOT NULL",` IF _operation IN('respec','renown') THEN
  IF _allocations IS NOT NULL OR _target_class IS NOT NULL
    OR (_operation='respec' AND _stat IS NOT NULL)
    OR (_operation='renown' AND (_stat IS NULL OR _stat<>ALL(ARRAY['str','dex','con','int','wis','cha'])))
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
  source_key:=CASE WHEN _operation='respec' THEN 'full_respec' ELSE 'renown_training' END;
  req:=jsonb_build_object('operation',_operation,'actorId',_actor,'expectedVersion',_expected_version,
    'contractVersion',1,'rulesVersion',1);
  IF _operation='renown' THEN req:=req||jsonb_build_object('stat',_stat); END IF;
 ELSIF _operation='allocate' THEN
  IF _stat IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','invalid_request'); END IF;
  IF _target_class IS NOT NULL`);
 s=once(s,'  IF _allocations IS NOT NULL OR _target_class IS NULL','  IF _stat IS NOT NULL OR _allocations IS NOT NULL OR _target_class IS NULL');
 s=once(s,'WHERE character_id=_character AND source=source_key AND event_id=_request;',
  "WHERE character_id=_character AND source IN('discretionary_allocation','order_command','full_respec','renown_training') AND event_id=_request;");
 s=once(s,'IF old.request<>req THEN','IF old.source<>source_key OR old.request<>req THEN');
 s=once(s,' IF FOUND THEN\n  IF old.source<>source_key',` IF FOUND THEN
  IF (SELECT count(*) FROM public.progression_receipt WHERE character_id=c.id AND event_id=_request
   AND source IN('discretionary_allocation','order_command','full_respec','renown_training'))<>1
  THEN RETURN jsonb_build_object('kind','refused','reason','request_conflict'); END IF;
  IF old.source<>source_key`);
 s=once(s,'IF NOT (SELECT enabled FROM public.progression_command_control WHERE singleton)',
  'IF (SELECT enabled FROM public.progression_command_control WHERE singleton) IS DISTINCT FROM true');
 s=once(s," IF c.hp<=0 THEN",` IF v>=9007199254740991 THEN RETURN jsonb_build_object('kind','refused','reason','arithmetic_overflow'); END IF;
 IF c.hp<=0 THEN`);
 s=once(s,'IF NOT FOUND OR (latest.receipt->>\'versionAfter\')::numeric IS DISTINCT FROM s.version',
  `IF NOT FOUND OR (latest.receipt->>'versionAfter')::numeric IS DISTINCT FROM s.version
   OR (latest.receipt->>'versionBefore')::numeric IS DISTINCT FROM s.version-1
   OR (SELECT count(*) FROM public.progression_receipt WHERE character_id=c.id AND (receipt->>'versionAfter')::numeric=s.version)<>1`);
 s=once(s," IF s.character_id IS NOT NULL AND s.version=0 AND counters<>",
  ` IF v=0 AND EXISTS(SELECT 1 FROM public.progression_receipt WHERE character_id=c.id)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 IF s.character_id IS NOT NULL AND s.version=0 AND counters<>`);
 s=once(s," IF EXISTS(SELECT 1 FROM public.node_fighter",` IF c.bhp IS NULL OR c.bhp<0 OR c.rp_total_earned IS NULL OR c.rp_total_earned<0
  OR jsonb_typeof(c.bhp_trained) IS DISTINCT FROM 'object'
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 FOR k,j IN SELECT * FROM jsonb_each(c.bhp_trained) LOOP
  IF k<>ALL(ARRAY['str','dex','con','int','wis','cha']) OR jsonb_typeof(j)<>'number'
  THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
  n:=j::text::numeric;
  IF n<0 OR n>2147483647 OR n<>trunc(n) THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 END LOOP;
 IF v>0 AND (latest.receipt->'after'->'trainedRanks' IS DISTINCT FROM c.bhp_trained
   OR (latest.receipt->'after'->>'renownBalance')::numeric IS DISTINCT FROM c.bhp)
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 SELECT * INTO old FROM public.progression_receipt WHERE character_id=c.id AND operation IN('respec','renown')
  ORDER BY (receipt->>'versionAfter')::numeric DESC LIMIT 1;
 IF FOUND AND (old.receipt->'after'->>'lifetimeRp')::numeric IS DISTINCT FROM c.rp_total_earned
 THEN RETURN jsonb_build_object('kind','refused','reason','inconsistent_provenance'); END IF;
 PERFORM 1 FROM public.progression_character_state WHERE character_id=c.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.node_fighter`);
 s=once(s," IF _operation='allocate' THEN\n  IF NOT EXISTS",` IF _operation IN('respec','renown') THEN
  IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_trainer)
  THEN RETURN jsonb_build_object('kind','refused','reason','not_at_trainer'); END IF;
  IF c.hp>c.max_hp OR c.cp>c.max_cp OR c.mp>c.max_mp
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
  PERFORM public.progression_class_config_internal(c.class,c.is_classless);
  RETURN public.progression_apply_f_internal(c.id,_actor,_request,v,_operation,_stat,req);
 END IF;
 IF _operation='allocate' THEN
  IF NOT EXISTS`);
 return s;
}
export function validation(){
 const expanded=expandedCommand();
 const start=expanded.indexOf(' SELECT * INTO s FROM public.progression_character_state');
 const end=expanded.indexOf(" IF _operation IN('respec','renown') THEN\n  IF NOT EXISTS");
 if(start<0||end<start)throw Error('F validator extraction drift');
 return `CREATE FUNCTION public.progression_validate_fresh_internal(_character uuid,_expected_version numeric,_operation text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.characters%ROWTYPE; s public.progression_character_state%ROWTYPE;
 latest public.progression_receipt%ROWTYPE; old public.progression_receipt%ROWTYPE;
 v numeric; counters jsonb; last_counters jsonb; k text; j jsonb; n numeric;
BEGIN
 IF auth.uid() IS NOT NULL THEN RETURN jsonb_build_object('kind','refused','reason','unauthorized'); END IF;
 SELECT * INTO STRICT c FROM public.characters WHERE id=_character FOR UPDATE;
${expanded.slice(start,end)}
 IF _operation IN('respec','renown') THEN
  IF NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=c.current_node_id AND is_trainer)
  THEN RETURN jsonb_build_object('kind','refused','reason','not_at_trainer'); END IF;
  IF c.hp>c.max_hp OR c.cp>c.max_cp OR c.mp>c.max_mp
  THEN RETURN jsonb_build_object('kind','refused','reason','invalid_state'); END IF;
 END IF;
 RETURN jsonb_build_object('kind','valid');
END $$;`;
}
export function command(){
 let s=expandedCommand();const start=s.indexOf(' SELECT * INTO s FROM public.progression_character_state');
 const end=s.indexOf(" IF _operation IN('respec','renown') THEN\n  IF NOT EXISTS");
 s=s.slice(0,start)+` result:=public.progression_validate_fresh_internal(c.id,_expected_version,_operation);
 IF result->>'kind'<>'valid' THEN RETURN result; END IF;
 SELECT * INTO s FROM public.progression_character_state WHERE character_id=c.id;
 v:=COALESCE(s.version,0);
 counters:=jsonb_build_object(${stats.map(k=>`'${k}',COALESCE(s.${k}_invested,0)`).join(',')});
`+s.slice(end);
 return s;
}
export function payload(){
 const pinned=[...dependencies.slice(0,5).map(([name,args,sql])=>[name,args,name==='progression_apply_xp_internal'?xpDefinition():definition(sql,name).sql]),
  ['progression_command','uuid,uuid,uuid,numeric,text,jsonb,text',definition(e,'progression_command').sql],
  ['progression_refuse_raw_progression_write','',definition(e,'progression_refuse_raw_progression_write').sql],
  ['progression_command_projection_internal','uuid',definition(e,'progression_command_projection_internal').sql],
  ...dependencies.slice(5).map(([name,args,sql])=>[name,args,definition(sql,name).sql])];
 let fence=definition(e,'progression_refuse_raw_progression_write').sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
  .replace('NEW.respec_points)','NEW.respec_points,NEW.bhp,NEW.bhp_trained,NEW.rp_total_earned)')
  .replace('OLD.respec_points)','OLD.respec_points,OLD.bhp,OLD.bhp_trained,OLD.rp_total_earned)');
 let projection=definition(e,'progression_command_projection_internal').sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
  .replace("'hp',c.hp,","'bhp',c.bhp,'bhp_trained',c.bhp_trained,'rp_total_earned',c.rp_total_earned,'hp',c.hp,");
 const body=read('scripts/progression-001F-authority.sql');
 const signatures=['progression_validate_fresh_internal(uuid,numeric,text)','progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)','progression_renown_draw_internal(uuid,uuid,text,numeric,numeric)',
  'progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','progression_refuse_raw_progression_write()','progression_command_projection_internal(uuid)'];
 const resulting=validation()+'\n'+body+'\n'+fence+'\n'+projection+'\n'+command();
 return `-- ENG-PROGRESSION-001F PREPARED ONLY; NOT INSTALLED / NOT ACTIVE.
-- Run only through a separately authorized standard Drizzle forward transaction.
-- No history registration, player mutation, activation or key rotation.
DO $guard$ DECLARE dep record; BEGIN
${pinned.map(([name,args,sql])=>` SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.${name}(${args})'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')<>'${sha(definition(sql,name).body)}'
 OR dep.proowner<>'postgres'::regrole OR dep.prosecdef IS DISTINCT FROM ${name!=='progression_refuse_raw_progression_write'}
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=${dependencies.find(d=>d[0]===name)?.[3]??'pg_catalog, public'}']
 OR dep.prorettype<>'${sql.match(/RETURNS\s+(\w+)/i)[1]}'::regtype OR dep.proretset
 OR dep.provolatile<>'${/\bSTABLE\b/i.test(sql.split(/AS \$/)[0])?'s':'v'}' OR dep.proparallel<>'u'
 OR dep.proisstrict OR dep.proleakproof OR dep.prokind<>'f'
 OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.pronargdefaults<>${(sql.split(/AS \$/)[0].match(/\bDEFAULT\b/g)??[]).length}
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM ${defaults(sql)}
 OR dep.proargnames IS DISTINCT FROM ${args?`ARRAY[${sql.match(/\(([\s\S]*?)\)\s*RETURNS/i)[1].split(',').map(a=>`'${a.trim().split(/\s+/)[0]}'`).join(',')}]`:'NULL::text[]'}
 THEN RAISE EXCEPTION '001F dependency drift: ${name}'; END IF;`).join('\n')}
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='progression_command')<>1
 OR NOT EXISTS(SELECT 1 FROM public.progression_command_control WHERE singleton AND NOT enabled)
 OR (SELECT count(*) FROM public.progression_command_control)<>1
 THEN RAISE EXCEPTION '001F command/control drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname=ANY(ARRAY[${pinned.map(d=>`'${d[0]}'`).join(',')}]) GROUP BY proname HAVING count(*)<>1)
 THEN RAISE EXCEPTION '001F dependency overload drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY[${pinned.filter(d=>d[0]!=='progression_command').map(d=>`'${d[0]}'`).join(',')}]) AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION '001F private dependency ACL drift'; END IF;
 -- Retained D/E RP writers must not provide a service/ordinary definer bypass around the raw fence.
 IF EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname<>'postgres'
 AND EXISTS(SELECT 1 FROM pg_proc fn WHERE fn.pronamespace='public'::regnamespace
 AND fn.proname IN('train_renown_stat','award_party_member','commit_encounter_tick_v2','node_tick_commit_without_bounded_failure')
 AND has_function_privilege(role.oid,fn.oid,'EXECUTE')))
 THEN RAISE EXCEPTION '001F legacy RP writer effective ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)'::regprocedure
 AND (a.grantee NOT IN(p.proowner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE'))
 OR NOT has_function_privilege('service_role','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)','EXECUTE')
 THEN RAISE EXCEPTION '001F narrow command ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN('public.progression_character_state'::regclass,
 'public.progression_receipt'::regclass,'public.progression_respec_milestone'::regclass,
 'public.progression_class_growth_milestone'::regclass,'public.progression_command_control'::regclass)
 AND (c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=c.oid)
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col,LATERAL aclexplode(col.attacl) a WHERE col.attrelid=c.oid AND a.grantee<>c.relowner)))
 THEN RAISE EXCEPTION '001F sidecar containment drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.characters'::regclass
 AND tgname='progression_refuse_raw_progression_write' AND tgenabled='O' AND tgtype=19
 AND tgfoid='public.progression_refuse_raw_progression_write()'::regprocedure)
 THEN RAISE EXCEPTION '001F raw fence trigger drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_receipt'::regclass
 AND conname='progression_receipt_operation_check' AND convalidated
 AND pg_get_constraintdef(oid)='CHECK ((operation = ANY (ARRAY[''xp''::text, ''permanent''::text, ''order''::text])))')
 THEN RAISE EXCEPTION '001F receipt constraint drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.characters'::regclass
 AND conname='characters_unspent_stat_points_check' AND convalidated
 AND pg_get_constraintdef(oid)='CHECK (((unspent_stat_points >= 0) AND (unspent_stat_points <= 200)))')
 THEN RAISE EXCEPTION '001F installed pool cap drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pgcrypto' AND extversion='1.3' AND extnamespace='extensions'::regnamespace)
 OR to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL OR to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
 THEN RAISE EXCEPTION '001F pgcrypto dependency missing'; END IF;
 IF to_regclass('public.progression_renown_key') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal'))
 THEN RAISE EXCEPTION '001F object collision'; END IF;
END $guard$;
ALTER TABLE public.progression_receipt DROP CONSTRAINT progression_receipt_operation_check;
ALTER TABLE public.progression_receipt ADD CONSTRAINT progression_receipt_operation_check CHECK(operation IN('xp','permanent','order','respec','renown'));
CREATE TABLE public.progression_renown_key (
 key_version integer PRIMARY KEY CHECK(key_version>0),active boolean NOT NULL,
 key_material bytea NOT NULL CHECK(octet_length(key_material)=32)
);
CREATE UNIQUE INDEX progression_renown_one_active_key ON public.progression_renown_key(active) WHERE active;
ALTER TABLE public.progression_renown_key OWNER TO postgres;
ALTER TABLE public.progression_renown_key ENABLE ROW LEVEL SECURITY;
INSERT INTO public.progression_renown_key VALUES(1,true,extensions.gen_random_bytes(32));
${validation()}
${body}
${fence}
${projection}
-- Exact old signature retired; RESTRICT stops unexpected dependencies, no overload survives.
DROP FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text);
${command().replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION')}
${signatures.map(sig=>`ALTER FUNCTION public.${sig} OWNER TO postgres;`).join('\n')}
DO $acl$ DECLARE p record; g record; BEGIN
 FOR p IN SELECT oid,proowner,oid::regprocedure::text identity,proacl FROM pg_proc
 WHERE pronamespace='public'::regnamespace AND proname IN('progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal',
  'progression_command','progression_refuse_raw_progression_write','progression_command_projection_internal','train_renown_stat') LOOP
  FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) WHERE grantee<>p.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',p.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
  END LOOP;
 END LOOP;
 FOR g IN SELECT DISTINCT grantee FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid='public.progression_renown_key'::regclass AND a.grantee<>c.relowner LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.progression_renown_key FROM %s',CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text) TO service_role;
 -- A table UPDATE grant implies every column. Preserve service writes to unrelated fields as column grants.
 IF has_table_privilege('service_role','public.characters','UPDATE') THEN
  FOR p IN SELECT attname FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attnum>0 AND NOT attisdropped
   AND attname<>ALL(ARRAY['str','dex','con','int','wis','cha','level','xp','class','is_classless','unspent_stat_points','respec_points','bhp','bhp_trained','rp_total_earned']) LOOP
   EXECUTE format('GRANT UPDATE(%I) ON public.characters TO service_role',p.attname);
  END LOOP;
 END IF;
 REVOKE UPDATE ON public.characters FROM service_role;
 REVOKE UPDATE(str,dex,con,int,wis,cha,level,xp,class,is_classless,unspent_stat_points,respec_points,bhp,bhp_trained,rp_total_earned) ON public.characters FROM service_role;
END $acl$;
DO $assert$ DECLARE installed record; BEGIN
${signatures.map(sig=>{
 const fn=definition(resulting,sig.split('(')[0]);
 return ` SELECT * INTO STRICT installed FROM pg_proc WHERE oid='public.${sig}'::regprocedure;
 IF encode(sha256(convert_to(replace(installed.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')<>'${sha(fn.body)}'
 OR installed.proowner<>'postgres'::regrole
 OR installed.prosecdef IS DISTINCT FROM ${!sig.startsWith('progression_refuse_raw')}
 OR installed.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR installed.prorettype<>'${fn.sql.match(/RETURNS\s+(\w+)/i)[1]}'::regtype OR installed.proretset OR installed.proparallel<>'u'
 OR installed.provolatile<>'${sig.startsWith('progression_command_projection')?'s':'v'}'
 OR installed.proisstrict OR installed.proleakproof OR installed.prokind<>'f'
 OR installed.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR installed.pronargdefaults<>${(fn.sql.split(/AS \$/)[0].match(/\bDEFAULT\b/g)??[]).length}
 OR pg_get_expr(installed.proargdefaults,0) IS DISTINCT FROM ${defaults(fn.sql)}
 OR installed.proargnames IS DISTINCT FROM ${sig.endsWith('()')?'NULL::text[]':`ARRAY[${fn.sql.match(/\(([\s\S]*?)\)\s*RETURNS/i)[1].split(',').map(a=>`'${a.trim().split(/\s+/)[0]}'`).join(',')}]`}
 THEN RAISE EXCEPTION '001F resulting function identity drift: ${sig}'; END IF;`;
}).join('\n')}
 IF (SELECT enabled FROM public.progression_command_control WHERE singleton)
 OR (SELECT count(*) FROM public.progression_renown_key WHERE active AND key_version=1)<>1
 THEN RAISE EXCEPTION '001F must install paused with one key'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname=ANY(ARRAY[${signatures.map(sig=>`'${sig.split('(')[0]}'`).join(',')}]) GROUP BY proname HAVING count(*)<>1)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.progression_renown_key'::regclass AND relowner='postgres'::regrole AND relrowsecurity)
 THEN RAISE EXCEPTION '001F resulting object metadata drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role') AND
  (has_table_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege(r.oid,'public.progression_renown_key','SELECT,INSERT,UPDATE,REFERENCES')))
 OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.progression_renown_key'::regclass)
 THEN RAISE EXCEPTION '001F key containment failed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname<>'postgres' AND
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND p.proname IN('progression_validate_fresh_internal','progression_apply_f_internal','progression_renown_draw_internal','train_renown_stat','progression_command_projection_internal','progression_refuse_raw_progression_write')
   AND has_function_privilege(r.oid,p.oid,'EXECUTE')))
 THEN RAISE EXCEPTION '001F inherited private EXECUTE'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['bhp','bhp_trained','rp_total_earned']) col
  WHERE has_column_privilege('service_role','public.characters',col,'UPDATE'))
 THEN RAISE EXCEPTION '001F inherited raw Renown UPDATE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid='public.progression_renown_key'::regclass AND a.grantee<>c.relowner)
 OR EXISTS(SELECT 1 FROM pg_attribute col,LATERAL aclexplode(col.attacl) a
  WHERE col.attrelid='public.progression_renown_key'::regclass AND a.grantee<>'postgres'::regrole)
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE NOT r.rolsuper AND r.rolname NOT IN('postgres','service_role')
  AND has_function_privilege(r.oid,'public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE'))
 THEN RAISE EXCEPTION '001F final ACL drift'; END IF;
END $assert$;
`;
}
export const releasePaths=['docs/operations/progression-001F-cutover.sql','.gitattributes','scripts/prepare-progression-001F.mjs','scripts/progression-001F-authority.sql',
 'supabase/functions/progression-command/index.ts','supabase/functions/_shared/progression-command.ts','src/features/character/progression-command.ts',
 'src/features/character/hooks/useStatAllocation.ts','src/features/character/components/TrainerPanel.tsx','src/features/character/progression-messages.ts',
 'src/features/character/components/OrderRecruiterDialog.tsx','src/features/character/components/StatPlannerDialog.tsx','src/pages/GamePage.tsx',
 'scripts/progression-001F-sql.test.mjs','scripts/progression-001F-combat2.test.mjs','scripts/progression-history-test.mjs',
 'src/features/character/__tests__/progression-f.test.tsx'];
export const manifest=()=>JSON.stringify({status:'IMPLEMENTED LOCALLY / PREPARED / NOT INSTALLED / NOT ACTIVE',encoding:'UTF-8, LF',
 startingCheckpoint:'448883efbbb5887e0033e4c987d153dfb8bfb7b3',
 resultingFunctionBodies:[...payload().matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)\(/g)].map(m=>({name:m[1],normalizedProsrcSha256:sha(definition(payload(),m[1]).body)})),
 artifacts:releasePaths.map(path=>{const s=read(path);return {path,sha256:sha(s),bytes:Buffer.byteLength(s),lines:s.split('\n').length-1};})},null,2)+'\n';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const sql=payload();
 if(process.argv.includes('--write')){writeFileSync(releasePaths[0],sql);for(const path of releasePaths)writeFileSync(path,read(path));writeFileSync('docs/operations/progression-001F-manifest.json',manifest());}
 if(process.argv.includes('--check')){
  if(readFileSync(releasePaths[0],'utf8')!==sql)throw Error('001F SQL drift');
  if(readFileSync('docs/operations/progression-001F-manifest.json','utf8')!==manifest())throw Error('001F manifest drift');
  const checkpoint='448883efbbb5887e0033e4c987d153dfb8bfb7b3';
  execFileSync('git',['merge-base','--is-ancestor',checkpoint,'HEAD']);
  const frozen=path=>execFileSync('git',['show',checkpoint+':'+path],{encoding:'utf8'}).replaceAll('\r\n','\n');
  if(read('docs/operations/progression-001E-manifest.json')!==frozen('docs/operations/progression-001E-manifest.json'))throw Error('Historical E manifest changed');
  for(const a of JSON.parse(read('docs/operations/progression-001E-manifest.json')).artifacts){
   if(sha(frozen(a.path))!==a.sha256)throw Error('Historical E source identity mismatch: '+a.path);
   if((a.path.startsWith('docs/operations/')||a.path.startsWith('scripts/'))&&read(a.path)!==frozen(a.path))throw Error('Frozen E preparation changed: '+a.path);
  }
  if(execFileSync('git',['diff','--name-only',checkpoint,'--','drizzle','supabase/migrations'],{encoding:'utf8'}).trim()
   ||execFileSync('git',['status','--porcelain','--','drizzle','supabase/migrations'],{encoding:'utf8'}).trim())throw Error('Historical migration/discovery prefix changed');
  for(const path of releasePaths)if(readFileSync(path,'utf8')!==read(path))throw Error('001F release line-ending drift: '+path);
 }
 console.log(JSON.stringify({sha256:sha(sql),bytes:Buffer.byteLength(sql),lines:sql.split('\n').length-1}));
}
