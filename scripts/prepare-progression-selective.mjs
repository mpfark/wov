// Deterministic local preparation; no database connection or migration registration.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {definition} from './prepare-progression-001E.mjs';
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
const hash=s=>createHash('sha256').update(s).digest('hex');
const f=read('drizzle/migrations/0005_progression_001f_canonical_renown_respec_authority.sql');
const e=read('drizzle/migrations/0003_progression_001e_command_authority.sql');
export function candidate(){
 const cmd=definition(f,'progression_command'), projection=definition(e,'progression_command_projection');
 const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('anchor drift: '+a);return s.replace(a,()=>b);};
 let body=replace(cmd.body," result:=public.progression_validate_fresh_internal(c.id,_expected_version,_operation);",` IF _operation IN('switch','renown') OR NOT COALESCE((SELECT CASE _operation
   WHEN 'join' THEN join_enabled WHEN 'allocate' THEN allocation_enabled
   WHEN 'respec' THEN respec_enabled ELSE false END
   FROM public.progression_command_control WHERE singleton),false)
 THEN RETURN jsonb_build_object('kind','refused','reason','operation_disabled'); END IF;
 result:=public.progression_validate_fresh_internal(c.id,_expected_version,_operation);`);
 // Claims serialize on the encounter before character reads. Acquire that boundary
 // before the character lock, never an encounter after locking the character.
 body=replace(body,' SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;',` PERFORM 1 FROM public.node_encounter WHERE node_id=initial_node ORDER BY id FOR UPDATE;
 SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE;`);
 const pbody=replace(projection.body,"public.progression_command_projection_internal(_character));",`public.progression_command_projection_internal(_character),
 'availability',jsonb_build_object(
  'join',COALESCE((SELECT enabled AND join_enabled FROM public.progression_command_control WHERE singleton),false),
  'allocate',COALESCE((SELECT enabled AND allocation_enabled FROM public.progression_command_control WHERE singleton),false),
  'respec',COALESCE((SELECT enabled AND respec_enabled FROM public.progression_command_control WHERE singleton),false),
  'switch',false,'renown',false));`);
 return `-- ENG-PROGRESSION-001E/F selective activation. LOCAL CANDIDATE, NOT INSTALLED.
-- One atomic DO; standard Drizzle tool owns the outer transaction. All flags default OFF.
DO $install$
DECLARE p record; before_command jsonb; before_projection jsonb; ddl text;
BEGIN
 LOCK TABLE public.progression_command_control IN ACCESS EXCLUSIVE MODE;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure;
 IF encode(sha256(convert_to(replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')<>'${hash(cmd.body)}'
  OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'progression command drift'; END IF;
 before_command:=to_jsonb(p)-'prosrc';
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.progression_validate_fresh_internal(uuid,numeric,text)'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND encode(sha256(convert_to(replace(prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')='${hash(definition(f,'progression_validate_fresh_internal').body)}') THEN RAISE EXCEPTION 'progression private dependency drift'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.progression_apply_f_internal(uuid,uuid,uuid,numeric,text,text,jsonb)'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND encode(sha256(convert_to(replace(prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')='${hash(definition(f,'progression_apply_f_internal').body)}') THEN RAISE EXCEPTION 'progression private dependency drift'; END IF;

 SELECT * INTO STRICT p FROM pg_proc WHERE oid='public.progression_command_projection(uuid)'::regprocedure;
 IF encode(sha256(convert_to(replace(p.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex')<>'${hash(projection.body)}'
  OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
 THEN RAISE EXCEPTION 'progression projection drift'; END IF;
 before_projection:=to_jsonb(p)-'prosrc';
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.progression_command_control'::regclass AND relowner='postgres'::regrole AND relrowsecurity)
  OR (SELECT count(*) FROM public.progression_command_control)<>1
  OR EXISTS(SELECT 1 FROM public.progression_command_control WHERE NOT singleton OR enabled)
  OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role') AND
   (has_table_privilege(r.oid,'public.progression_command_control','SELECT,INSERT,UPDATE,DELETE')
    OR has_any_column_privilege(r.oid,'public.progression_command_control','SELECT,INSERT,UPDATE')))
  OR has_function_privilege('anon','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)','EXECUTE')
  OR has_function_privilege('anon','public.progression_command_projection(uuid)','EXECUTE')
  OR NOT has_function_privilege('authenticated','public.progression_command_projection(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'progression control/authority drift'; END IF;
 ALTER TABLE public.progression_command_control
  ADD COLUMN join_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN allocation_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN respec_enabled boolean NOT NULL DEFAULT false;
 ddl:=pg_get_functiondef('public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure);
 ddl:=replace(ddl,(SELECT prosrc FROM pg_proc WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure),$newcommand$${body}$newcommand$);
 EXECUTE ddl;
 ddl:=pg_get_functiondef('public.progression_command_projection(uuid)'::regprocedure);
 ddl:=replace(ddl,(SELECT prosrc FROM pg_proc WHERE oid='public.progression_command_projection(uuid)'::regprocedure),$newprojection$${pbody}$newprojection$);
 EXECUTE ddl;
 IF (SELECT to_jsonb(x)-'prosrc' FROM pg_proc x WHERE oid='public.progression_command(uuid,uuid,uuid,numeric,text,jsonb,text,text)'::regprocedure) IS DISTINCT FROM before_command
  OR (SELECT to_jsonb(x)-'prosrc' FROM pg_proc x WHERE oid='public.progression_command_projection(uuid)'::regprocedure) IS DISTINCT FROM before_projection
 THEN RAISE EXCEPTION 'progression metadata changed'; END IF;
END $install$;
`;
}
if(process.argv.includes('--write'))writeFileSync('docs/operations/progression-selective-activation.sql',candidate());
