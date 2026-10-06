/** Local deterministic SQL generation, never a hosted/runner connection. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
export function definition(sql,name){
 const re=new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?AS (\\$[a-z_]*\\$)([\\s\\S]*?)\\1;`,'i');
 const m=sql.match(re);if(!m)throw Error(`Missing definition ${name}`);return {sql:m[0],body:m[2]};
}
const base=read('docs/operations/progression-001C-authority.sql');
const classes=read('supabase/migrations/20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql');
const renown=read('supabase/migrations/20260731072756_3e051877-cae6-4323-9e35-a5b19fb63857.sql');
export const dependencies=[
 ['progression_apply_xp_internal','uuid,uuid,text,numeric,jsonb',base,'pg_catalog, public'],
 ['progression_apply_permanent_delta_internal','uuid,uuid,text,numeric,jsonb,jsonb',base,'pg_catalog, public'],
 ['progression_class_config_internal','text,boolean',base,'pg_catalog, public'],
 ['progression_snapshot_internal','uuid',base,'pg_catalog, public'],
 ['character_sync_derived_internal','uuid,boolean,boolean',base,'pg_catalog, public'],
 ['join_order','uuid,text',classes,'public'],['switch_order','uuid,text',classes,'public'],
 ['award_class_bond','uuid,text,integer',classes,'public'],
 ['award_class_bond_for_kill','uuid,integer,boolean',classes,'public'],
 ['train_renown_stat','uuid,text',renown,'public'],
];
function once(s,a,b){if(s.split(a).length!==2)throw Error(`Patch anchor cardinality: ${a}`);return s.replace(a,()=>b);}
export function xpDefinition(){
 let s=definition(base,'progression_apply_xp_internal').sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
 s=once(s,' IF lv=42 THEN discarded:=rem; rem:=0; END IF;',` IF lv=42 THEN discarded:=rem; rem:=0; END IF;
 -- Independent destination proof: never silently skip contradictory new events.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(crossed) x
   WHERE x::integer%3=0 AND (EXISTS(SELECT 1 FROM public.progression_class_growth_milestone m
     WHERE m.character_id=_character AND m.destination_level=x::integer)
   OR EXISTS(SELECT 1 FROM public.progression_receipt p,
       LATERAL jsonb_array_elements_text(COALESCE(p.receipt->'crossedLevels','[]')) y
     WHERE p.character_id=_character AND p.operation='xp' AND y::integer=x::integer)))
 THEN RAISE EXCEPTION 'class_growth_destination_conflict'; END IF;`);
 s=once(s," RETURN jsonb_build_object('kind','committed','receipt',r);",` INSERT INTO public.progression_class_growth_milestone
   (character_id,destination_level,class_key,is_classless,applied_deltas,config_fingerprint,source,event_id)
 SELECT _character,x::integer,c.class,c.is_classless,growth,cfg->>'fingerprint',_source,_event
 FROM jsonb_array_elements_text(crossed) x WHERE x::integer%3=0;
 RETURN jsonb_build_object('kind','committed','receipt',r);`);
 return s;
}
export function guards(){return `DO $guard$ DECLARE dep record; BEGIN
${dependencies.map(([name,args,sql,search])=>` SELECT * INTO STRICT dep FROM pg_proc WHERE oid='public.${name}(${args})'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')<>'${sha(definition(sql,name).body)}'
   OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=${search}']
   OR dep.prorettype<>'${definition(sql,name).sql.match(/RETURNS\s+(\w+)/i)[1]}'::regtype OR dep.proretset OR dep.provolatile<>'${/\bSTABLE\b/i.test(definition(sql,name).sql.split(/AS \$/)[0])?'s':'v'}'
   OR dep.proargnames IS DISTINCT FROM ARRAY[${definition(sql,name).sql.match(/\(([\s\S]*?)\)\s*RETURNS/i)[1].split(',').map(a=>`'${a.trim().split(/\s+/)[0]}'`).join(',')}]
 THEN RAISE EXCEPTION '001E dependency body/security drift: ${name}'; END IF;`).join('\n')}
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
   AND proname=ANY(ARRAY[${dependencies.map(d=>`'${d[0]}'`).join(',')}]) GROUP BY proname HAVING count(*)<>1)
 THEN RAISE EXCEPTION '001E dependency overload drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.pronamespace='public'::regnamespace AND p.proname=ANY(ARRAY[${dependencies.slice(0,5).map(d=>`'${d[0]}'`).join(',')}]) AND a.grantee<>p.proowner)
 THEN RAISE EXCEPTION '001E private authority ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class rel WHERE rel.oid IN('public.progression_character_state'::regclass,'public.progression_receipt'::regclass,'public.progression_respec_milestone'::regclass)
   AND (rel.relowner<>'postgres'::regrole OR NOT rel.relrowsecurity
    OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=rel.oid)
    OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(rel.relacl,acldefault('r',rel.relowner))) a WHERE a.grantee<>rel.relowner)))
 THEN RAISE EXCEPTION '001E sidecar security drift'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.character_class_bonds'::regclass)
 OR EXISTS(SELECT 1 FROM pg_policy policy WHERE policy.polrelid='public.character_class_bonds'::regclass AND policy.polcmd<>'r'
   AND EXISTS(SELECT 1 FROM unnest(policy.polroles) role WHERE CASE WHEN role=0 THEN true ELSE
     pg_has_role('anon',role,'MEMBER') OR pg_has_role('authenticated',role,'MEMBER') END))
 THEN RAISE EXCEPTION '001E ordinary bond RLS drift'; END IF;
 IF to_regclass('public.progression_class_growth_milestone') IS NOT NULL
 OR to_regclass('public.progression_command_control') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
   ('progression_command','progression_command_projection','progression_command_projection_internal','progression_refuse_raw_progression_write','progression_verify_class_growth_internal'))
 THEN RAISE EXCEPTION '001E object collision'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.progression_receipt'::regclass
   AND conname='progression_receipt_operation_check' AND pg_get_constraintdef(oid) LIKE '%xp%permanent%')
 THEN RAISE EXCEPTION '001E receipt schema drift'; END IF;
 -- Full trigger fingerprints supplied by accepted 001C inspection, unchanged in preflight.
 IF encode(sha256(convert_to(pg_get_functiondef('public.restrict_party_leader_updates()'::regprocedure),'UTF8')),'hex')
   <>'02c3aaa505f08fb4f9e92ffcf16ba41cb9e3ae79e51aaabdf4fde4f0876f465d'
 OR encode(sha256(convert_to(pg_get_functiondef('public.combat2_refuse_invalid_stance_class_change()'::regprocedure),'UTF8')),'hex')
   <>'98745bca6cbb73743ef7c22dc7c8484024b904d9357e7d97a7b1af86275f76c1'
 THEN RAISE EXCEPTION '001E installed trigger drift'; END IF;
 IF has_table_privilege('authenticated','public.characters','UPDATE')
 OR has_table_privilege('anon','public.characters','UPDATE')
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['str','dex','con','int','wis','cha','class','is_classless','unspent_stat_points','respec_points']) col
   WHERE has_column_privilege('authenticated','public.characters',col,'UPDATE')
      OR has_column_privilege('anon','public.characters',col,'UPDATE'))
 THEN RAISE EXCEPTION '001E character browser ACL drift'; END IF;
END $guard$;`;}
export const fenced=['join_order(uuid,text)','switch_order(uuid,text)','award_class_bond(uuid,text,integer)',
 'award_class_bond_for_kill(uuid,integer,boolean)','train_renown_stat(uuid,text)'];
export function payload(){
 let sql=read('scripts/progression-001E-commands.sql');
 sql+=`\n${['str','dex','con','int','wis','cha'].map(k=>`ALTER TABLE public.progression_class_growth_milestone ADD CHECK(jsonb_typeof(applied_deltas->'${k}')='number' AND (applied_deltas->>'${k}')::numeric BETWEEN 0 AND 2147483647 AND (applied_deltas->>'${k}')::numeric=trunc((applied_deltas->>'${k}')::numeric));`).join('\n')}\n`;
 sql+=`ALTER FUNCTION public.progression_verify_class_growth_internal() OWNER TO postgres;
ALTER FUNCTION public.progression_refuse_raw_progression_write() OWNER TO postgres;
ALTER FUNCTION public.progression_command_projection_internal(uuid) OWNER TO postgres;
ALTER FUNCTION public.progression_command_projection(uuid) OWNER TO postgres;
ALTER FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text) OWNER TO postgres;\n`;
 const functions=[...sql.matchAll(/CREATE FUNCTION public\.([a-z_]+)\(([^)]*)\)/g)].map(m=>m[1]);
 return `-- ENG-PROGRESSION-001E LOCAL PREPARATION; NOT INSTALLED / NOT ACTIVE.
-- Reviewed source: ${sha(base)} (001C); no historical migration edits/backfill.
-- ONE standard Lovable Drizzle tool transaction required. No standalone execution.
-- Command control starts disabled; separate explicit activation required.
${guards()}
${sql}
${xpDefinition()}
-- Strip every default/custom/inherited nonowner grant. Only narrow commands regain intended EXECUTE.
DO $acl$ DECLARE p record; g record; BEGIN
 FOR p IN SELECT oid,proowner,oid::regprocedure::text identity FROM pg_proc
   WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[${[...functions,'progression_apply_xp_internal',...fenced.map(x=>x.split('(')[0])].map(n=>`'${n}'`).join(',')}]) LOOP
   IF p.proowner<>'postgres'::regrole THEN RAISE EXCEPTION '001E unexpected function owner'; END IF;
   FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=p.oid),acldefault('f',p.proowner))) WHERE grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',p.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
   END LOOP;
 END LOOP;
 FOR p IN SELECT oid,relowner owner,oid::regclass::text identity,relacl FROM pg_class
   WHERE oid IN ('public.progression_class_growth_milestone'::regclass,'public.progression_command_control'::regclass) LOOP
   FOR g IN SELECT DISTINCT grantee FROM aclexplode(COALESCE(p.relacl,acldefault('r',p.owner))) WHERE grantee<>p.owner LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM %s',p.identity,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
   END LOOP;
 END LOOP;
 GRANT EXECUTE ON FUNCTION public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text) TO service_role;
 GRANT EXECUTE ON FUNCTION public.progression_command_projection(uuid) TO authenticated;
END $acl$;
DO $assert$ DECLARE sig text; BEGIN
 FOREACH sig IN ARRAY ARRAY[${fenced.map(s=>`'public.${s}'`).join(',')}] LOOP
  IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=sig::regprocedure AND a.grantee<>p.proowner) THEN RAISE EXCEPTION '001E containment failed: %',sig; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname<>'postgres'
   AND EXISTS(SELECT 1 FROM pg_proc fn WHERE fn.pronamespace='public'::regnamespace
    AND fn.proname=ANY(ARRAY[${[...functions.filter(n=>!['progression_command','progression_command_projection'].includes(n)),...dependencies.slice(0,5).map(d=>d[0]),...fenced.map(s=>s.split('(')[0])].map(n=>`'${n}'`).join(',')}])
    AND has_function_privilege(role.oid,fn.oid,'EXECUTE')))
 THEN RAISE EXCEPTION '001E effective inherited private/legacy EXECUTE'; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname NOT IN('postgres','service_role')
   AND has_function_privilege(role.oid,'public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text)','EXECUTE'))
 THEN RAISE EXCEPTION '001E effective narrow-command ACL drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class rel WHERE rel.oid IN('public.progression_class_growth_milestone'::regclass,'public.progression_command_control'::regclass)
   AND (rel.relowner<>'postgres'::regrole OR NOT rel.relrowsecurity OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=rel.oid)
    -- Built-in global database authority roles intrinsically bypass ACLs. Custom/ordinary members still fail this check.
    OR EXISTS(SELECT 1 FROM pg_roles role WHERE NOT role.rolsuper AND role.rolname<>'postgres' AND role.rolname !~ '^pg_'
      AND has_table_privilege(role.oid,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))))
 THEN RAISE EXCEPTION '001E effective sidecar containment failed'; END IF;
 IF (SELECT enabled FROM public.progression_command_control WHERE singleton) THEN RAISE EXCEPTION '001E must install inactive'; END IF;
END $assert$;
`;}
// Exported expected bytes for test fixtures, not a mechanism to bypass hosted guards.
export const expectedBody=(name)=>definition(dependencies.find(d=>d[0]===name)[2],name).body;
export const releasePaths=['docs/operations/progression-001E-cutover.sql','scripts/prepare-progression-001E.mjs','scripts/progression-001E-commands.sql',
 'supabase/functions/progression-command/index.ts','supabase/functions/_shared/progression-command.ts','supabase/config.toml',
 'src/features/character/progression-command.ts','src/features/character/hooks/useStatAllocation.ts',
 'src/features/character/components/OrderRecruiterDialog.tsx','src/features/character/components/StatPlannerDialog.tsx',
 'src/features/character/components/TrainerPanel.tsx','src/pages/GamePage.tsx'];
export function manifest(){return JSON.stringify({status:'IMPLEMENTED LOCALLY / PREPARED / NOT INSTALLED / NOT ACTIVE',encoding:'UTF-8, LF',
 artifacts:releasePaths.map(path=>{const s=read(path);return {path,sha256:sha(s),bytes:Buffer.byteLength(s),lines:s.split('\n').length-1};})},null,2)+'\n';}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const p=payload();if(process.argv.includes('--write'))writeFileSync('docs/operations/progression-001E-cutover.sql',p);
 if(process.argv.includes('--write')){
  for(const path of releasePaths)writeFileSync(path,read(path));
  writeFileSync('docs/operations/progression-001E-manifest.json',manifest());
 }
 if(process.argv.includes('--check')){
  if(readFileSync('docs/operations/progression-001E-cutover.sql','utf8')!==p)throw Error('001E payload drift');
  if(readFileSync('docs/operations/progression-001E-manifest.json','utf8')!==manifest())throw Error('001E manifest drift');
  for(const path of releasePaths)if(readFileSync(path,'utf8')!==read(path))throw Error('001E release line-ending drift: '+path);
 }
 console.log(JSON.stringify({sha256:sha(p),bytes:Buffer.byteLength(p),lines:p.split('\n').length-1}));
}
