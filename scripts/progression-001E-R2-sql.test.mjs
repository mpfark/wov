/** Exact R2 artifact on full disposable E fixture; no hosted connection mode. */
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
import {read,definition,dependencies,payload as ePayload,sha} from './prepare-progression-001E.mjs';
import {canonical,deviated,deviatedPayload,bodyHash,deviatedHash,payload,sig} from './prepare-progression-001E-R2.mjs';
if(!process.argv[2])throw Error('Supply local PGlite module path');const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
let db;const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function transaction(fn){await db.exec('BEGIN');try{return await fn();}finally{await db.exec('ROLLBACK');}}
const metadata=async()=> (await q(`SELECT p.*,pg_get_functiondef(p.oid) definition,pg_get_expr(proargdefaults,0) defaults FROM pg_proc p WHERE oid=$1::regprocedure`,[sig]))[0];
async function otherObjects(){const catalog=await q(`SELECT * FROM (SELECT 'function' kind,to_jsonb(p) object FROM pg_proc p WHERE pronamespace='public'::regnamespace AND oid<>$1::regprocedure
 UNION ALL SELECT 'relation',to_jsonb(c) FROM pg_class c WHERE relnamespace='public'::regnamespace
 UNION ALL SELECT 'trigger',to_jsonb(t) FROM pg_trigger t WHERE tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
 UNION ALL SELECT 'policy',to_jsonb(p) FROM pg_policy p WHERE polrelid IN(SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
 UNION ALL SELECT 'constraint',to_jsonb(c) FROM pg_constraint c WHERE connamespace='public'::regnamespace) catalog ORDER BY kind,object::text`,[sig]);
 const data=[];for(const {relname}of await q("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' ORDER BY relname"))data.push({relname,rows:await q(`SELECT to_jsonb(t) row FROM public."${relname.replaceAll('"','""')}" t ORDER BY to_jsonb(t)::text`)});return {catalog,data};}
before(async()=>{db=new PGlite();const fixture=read('scripts/progression-001C-sql.test.mjs').match(/const fixture=`([\s\S]*?)`;/)[1],extra=read('scripts/progression-001E-sql.test.mjs').match(/const extra=`([\s\S]*?)`;/)[1];await db.exec(fixture+extra);await db.exec(read('docs/operations/progression-001C-authority.sql'));
 for(const [name,,sql]of dependencies.slice(5))await db.exec(definition(sql,name).sql);
 for(const [file,name]of [['supabase/migrations/20260629080249_d6091f9a-cb36-4b1f-9beb-4966956f5e93.sql','restrict_party_leader_updates'],['supabase/migrations/20261001130000_combat2_character_persistent_stances.sql','combat2_refuse_invalid_stance_class_change']])await db.exec(definition(read(file),name).sql);
 await db.exec('CREATE TRIGGER restrict_party_leader_updates BEFORE UPDATE ON characters FOR EACH ROW EXECUTE FUNCTION restrict_party_leader_updates(); CREATE TRIGGER combat2_refuse_invalid_stance_class_change BEFORE UPDATE OF class ON characters FOR EACH ROW EXECUTE FUNCTION combat2_refuse_invalid_stance_class_change();');
 await db.exec("INSERT INTO classes(class_key,base_hp,level_bonuses) VALUES('wizard',16,'{\"int\":1,\"wis\":1}'); INSERT INTO characters(id,user_id,str,hp) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',44,3);");
 await db.exec(ePayload());await db.exec(deviated.sql);
});after(async()=>await db?.close());
test('known deviation is precisely installed historical 0003; R1 and all existing release sources unchanged',()=>{
 assert.equal(sha(deviatedPayload),'225cb43a26f63f8e9a5645bb60ab0b273847773a5c51310d75ac118721419968');assert.equal(read('drizzle/migrations/0003_progression_001e_command_authority.sql'),deviatedPayload);
 assert.equal(read('docs/operations/progression-001E-cutover.sql'),execFileSync('git',['show','daf38a44:docs/operations/progression-001E-cutover.sql'],{encoding:'utf8'}));
 const manifest=JSON.parse(read('docs/operations/progression-001E-manifest.json'));for(const a of manifest.artifacts)assert.equal(sha(read(a.path)),a.sha256,a.path);
 assert.equal(Buffer.byteLength(deviated.body)-Buffer.byteLength(canonical.body),1);
});
test('known deviated function passes precondition; exact canonical body/security result; no other object/data/control change',async()=>transaction(async()=>{
 const before=await metadata();assert.equal(sha(before.prosrc),deviatedHash);const untouched=await otherObjects();
 await db.exec(read('docs/operations/progression-001E-R2-xp-body-repair.sql'));const after=await metadata();assert.equal(after.prosrc,canonical.body);assert.equal(sha(after.prosrc),bodyHash);
 assert.deepEqual({...before,prosrc:after.prosrc,definition:after.definition},after);
 assert.deepEqual(await otherObjects(),untouched);assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);
 const m=JSON.parse(read('docs/operations/progression-001E-R2-manifest.json'));assert.equal(sha(after.definition),m.canonicalPgGetFunctiondefSha256);
 for(const role of ['anon','authenticated','service_role','custom_default'])assert.equal((await q('SELECT has_function_privilege($1,$2,\'EXECUTE\') yes',[role,sig]))[0].yes,false);
}));
test('already-canonical repeat is fail-closed idempotence safe',async()=>transaction(async()=>{await db.exec(payload());const first=await metadata(),other=await otherObjects();await db.exec(payload());assert.deepEqual(await metadata(),first);assert.deepEqual(await otherObjects(),other);}));
test('unknown semantic and whitespace bodies abort before replacement',async()=>{
 for(const modified of [deviated.sql.replace("'invalid_award'","'unknown_award'"),deviated.sql.replace('DECLARE c','DECLARE  c')])await transaction(async()=>{await db.exec(modified);await assert.rejects(db.exec(payload()),/precondition.*drift/);});
});
test('owner/security/search_path/volatility/default/ACL and effective owner inheritance drift abort',async()=>{
 for(const sql of [`ALTER FUNCTION ${sig} SECURITY INVOKER`,`ALTER FUNCTION ${sig} SET search_path=public`,`ALTER FUNCTION ${sig} STABLE`,`ALTER FUNCTION ${sig} OWNER TO custom_default`,`GRANT EXECUTE ON FUNCTION ${sig} TO PUBLIC`,`GRANT EXECUTE ON FUNCTION ${sig} TO service_role`,'GRANT postgres TO custom_default',deviated.sql.replace("DEFAULT '{}'::jsonb","DEFAULT '{\"unknown\":true}'::jsonb")])await transaction(async()=>{await db.exec(sql);await assert.rejects(db.exec(payload()),/precondition.*drift/);});
});
test('transcription error inside repair body fails final assertion and entire transaction restores known deviation',async()=>{
 const original=await metadata(),other=await otherObjects();await transaction(async()=>{const broken=payload().replace(canonical.sql,()=>deviated.sql);await assert.rejects(db.exec(broken),/result.*drift/);});assert.deepEqual(await metadata(),original);assert.deepEqual(await otherObjects(),other);
});
test('guard normalization changes CRLF only, preserving spaces',async()=>transaction(async()=>{await db.exec(deviated.sql.replaceAll('\n','\r\n'));await db.exec(payload());assert.equal((await metadata()).prosrc,canonical.body);}));

test('known whitespace body and repaired authority produce identical local XP outcome and durable data',async()=>{
 const award=async()=>{const result=await q('SELECT progression_apply_xp_internal($1,$2,$3,$4,$5) result',['11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','admin_xp',250,{actorId:'22222222-2222-4222-8222-222222222222',reason:'local R2 equivalence'}]);assert.equal(result[0].result.kind,'committed');return {result,data:(await otherObjects()).data};};
 const before=await transaction(award);const after=await transaction(async()=>{await db.exec(payload());return award();});assert.deepEqual(after,before);
});
