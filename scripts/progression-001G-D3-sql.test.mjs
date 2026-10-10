import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const sql=readFileSync('docs/operations/progression-001G-D3-direct-teleport-containment.sql','utf8');
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE FUNCTION public.admin_teleport(uuid,uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN NULL; END;$$;
 REVOKE ALL ON FUNCTION public.admin_teleport(uuid,uuid) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) TO authenticated,service_role;
 CREATE FUNCTION public.ordinary_move() RETURNS void LANGUAGE plpgsql AS $$BEGIN NULL; END;$$;`);
 return db;
}
const can=async(db,role)=>(await db.query(`SELECT has_function_privilege($1,'public.admin_teleport(uuid,uuid)','EXECUTE') AS allowed`,[role])).rows[0].allowed;
test('browser denied; service and owner retained; definitions and ordinary movement unchanged',async()=>{
 const db=await fixture();try{
 const before=(await db.query(`SELECT pg_get_functiondef('public.admin_teleport(uuid,uuid)'::regprocedure) AS body`)).rows[0].body;
 await db.exec(sql);
 assert.equal(await can(db,'anon'),false);assert.equal(await can(db,'authenticated'),false);assert.equal(await can(db,'service_role'),true);
 assert.equal((await db.query(`SELECT pg_get_functiondef('public.admin_teleport(uuid,uuid)'::regprocedure) AS body`)).rows[0].body,before);
 assert.equal((await db.query(`SELECT has_function_privilege('authenticated','public.ordinary_move()','EXECUTE') AS allowed`)).rows[0].allowed,true);
 }finally{await db.close();}
});
test('PUBLIC leak removed with existing direct service grant',async()=>{
 const db=await fixture();try{await db.exec('GRANT EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) TO PUBLIC;');
 await db.exec(sql);assert.equal(await can(db,'anon'),false);assert.equal(await can(db,'service_role'),true);
 }finally{await db.close();}
});
test('inherited browser leak aborts and ACL changes roll back',async()=>{
 const db=await fixture();try{await db.exec('CREATE ROLE legacy_delegate; GRANT legacy_delegate TO authenticated; GRANT EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) TO legacy_delegate;');
 await assert.rejects(db.exec(sql),/browser inherited EXECUTE/);await db.exec('ROLLBACK');assert.equal(await can(db,'authenticated'),true);
 }finally{await db.close();}
});
test('missing signature refuses rather than silently recording containment',async()=>{
 const db=await fixture();try{await db.exec('DROP FUNCTION public.admin_teleport(uuid,uuid);');await assert.rejects(db.exec(sql),/does not exist/);await db.exec('ROLLBACK');}finally{await db.close();}
});

test('service relying only on PUBLIC causes safe stop and rollback',async()=>{const db=await fixture();try{await db.exec('REVOKE EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) FROM service_role; GRANT EXECUTE ON FUNCTION public.admin_teleport(uuid,uuid) TO PUBLIC;');await assert.rejects(db.exec(sql),/service EXECUTE changed/);await db.exec('ROLLBACK');assert.equal(await can(db,'service_role'),true);}finally{await db.close();}});
