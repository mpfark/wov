/** Offline R2 forward-repair generation; pinned disposable PostgreSQL only. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {sha,read,definition} from './prepare-progression-001E.mjs';
export const source='docs/operations/progression-001E-cutover.sql';
export const target='docs/operations/progression-001E-R2-xp-body-repair.sql';
export const sig='public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb)';
export const canonical=definition(read(source),'progression_apply_xp_internal');
if(sha(read(source))!=='734e6a1934372b548003e0336b9207998f6da8de01057e66ad63ef5950569b40')throw Error('Reviewed R1 source drift');
const lines=read(source).split('\n');if(lines[339]!==" THEN RETURN jsonb_build_object('kind','refused','reason','ineligible_source'); END IF;")throw Error('Deviation anchor drift');
lines[339]=' '+lines[339];export const deviatedPayload=lines.join('\n');
export const deviated=definition(deviatedPayload,'progression_apply_xp_internal');
export const bodyHash=sha(canonical.body),deviatedHash=sha(deviated.body);
export function guard(final=false){return `DO $r2$ DECLARE dep record; BEGIN
 SELECT * INTO STRICT dep FROM pg_proc WHERE oid='${sig}'::regprocedure;
 IF encode(sha256(convert_to(replace(dep.prosrc,E'\\r\\n',E'\\n'),'UTF8')),'hex') ${final?`<>'${bodyHash}'`:`NOT IN('${deviatedHash}','${bodyHash}')`}
 OR dep.proowner<>'postgres'::regrole OR NOT dep.prosecdef
 OR dep.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
 OR dep.prorettype<>'jsonb'::regtype OR dep.proretset OR dep.provolatile<>'v'
 OR dep.prokind<>'f' OR dep.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
 OR dep.proargnames IS DISTINCT FROM ARRAY['_character','_event','_source','_offered','_metadata']
 OR dep.pronargs<>5 OR dep.proargtypes IS DISTINCT FROM '2950 2950 25 1700 3802'::oidvector
 OR dep.proallargtypes IS NOT NULL OR dep.proargmodes IS NOT NULL OR dep.pronargdefaults<>1
 OR pg_get_expr(dep.proargdefaults,0) IS DISTINCT FROM '''{}''::jsonb'
 OR dep.proisstrict OR dep.proleakproof OR dep.proparallel<>'u' OR dep.procost<>100 OR dep.prorows<>0 OR dep.prosupport<>0
 OR (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='progression_apply_xp_internal')<>1
 OR EXISTS(SELECT 1 FROM aclexplode(COALESCE(dep.proacl,acldefault('f',dep.proowner))) a WHERE a.grantee<>dep.proowner)
 OR EXISTS(SELECT 1 FROM pg_roles role WHERE role.rolname<>'postgres'
   AND (NOT role.rolsuper OR role.rolname IN('anon','authenticated','service_role'))
   AND has_function_privilege(role.oid,dep.oid,'EXECUTE'))
 THEN RAISE EXCEPTION '001E R2 ${final?'result':'precondition'} XP body/security/ACL drift'; END IF;
END $r2$;`;}
export function payload(){return `-- ENG-PROGRESSION-001E-R2 PREPARED ONLY; NO HOSTED EXECUTION AUTHORIZED.
-- One future standard Drizzle transaction; no full 001E replay or standalone lifecycle.
-- Only public.progression_apply_xp_internal(uuid,uuid,text,numeric,jsonb) may change.
-- Canonical CRLF-to-LF prosrc SHA-256: ${bodyHash}
-- Known one-leading-space deviation SHA-256: ${deviatedHash}
-- No trimming/collapsing whitespace. Already-canonical identity also accepted for safe replay.
${guard()}
${canonical.sql}
ALTER FUNCTION ${sig} OWNER TO postgres;
ALTER FUNCTION ${sig} SECURITY DEFINER;
ALTER FUNCTION ${sig} SET search_path=pg_catalog,public;
REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION ${sig} TO postgres;
${guard(true)}
`;}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);const db=new PGlite();
 await db.exec('SET check_function_bodies=false;'+canonical.sql);const def=(await db.query('SELECT pg_get_functiondef($1::regprocedure) d',[sig])).rows[0].d;await db.close();
 const sql=payload(),manifest={schemaVersion:1,canonicalSource:{path:source,sha256:sha(read(source))},normalization:'prosrc UTF-8; CRLF to LF only; no trim or whitespace collapse',canonicalProsrcSha256:bodyHash,knownDeviatedProsrcSha256:deviatedHash,modeledDeviatedMigrationSha256:sha(deviatedPayload),canonicalPgGetFunctiondefSha256:sha(def),pgGetFunctiondefScope:'Local PGlite PostgreSQL renderer diagnostic only; guards use exact normalized prosrc plus full security/signature/ACL metadata',artifacts:[{path:target,sha256:sha(sql),bytes:Buffer.byteLength(sql),lines:sql.split('\n').length-1},{path:'scripts/prepare-progression-001E-R2.mjs',sha256:sha(read('scripts/prepare-progression-001E-R2.mjs'))}]};
 const mf='docs/operations/progression-001E-R2-manifest.json';if(process.argv.includes('--write')){writeFileSync(target,sql);writeFileSync(mf,JSON.stringify(manifest,null,2)+'\n');}else if(readFileSync(target,'utf8')!==sql||read(mf)!==JSON.stringify(manifest,null,2)+'\n')throw Error('R2 deterministic artifact drift');console.log(JSON.stringify(manifest,null,2));
}
