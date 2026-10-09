/** Disposable PGlite only. Usage: node scripts/progression-001G-C2-S2-sql.test.mjs <local-pglite-index.js>
 * No network, connection strings, hosted writes or creation RPC. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw new Error('Supply local PGlite module path');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const sql = readFileSync('docs/operations/progression-001G-C2-S2-name-identity.sql','utf8');
const preflight = readFileSync('docs/operations/progression-001G-C2-S2-name-preflight.sql','utf8');
async function fixture(fn, collation = '') {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.characters(id integer PRIMARY KEY, name text ${collation}, level integer DEFAULT 1);
      ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.characters TO authenticated;
      GRANT INSERT,UPDATE ON public.characters TO service_role;`);
    await fn(db);
  } finally { await db.close(); }
}
async function install(db) {
  await db.exec('BEGIN');
  try { await db.exec(sql); await db.exec('COMMIT'); }
  catch (e) { await db.exec('ROLLBACK'); throw e; }
}
const rows = async db => (await db.query('SELECT * FROM public.characters ORDER BY id')).rows;
const metadata = async db => (await db.query(`SELECT relacl,relrowsecurity FROM pg_class WHERE oid='public.characters'::regclass`)).rows;
test('successful installation preserves display bytes, legacy values, RLS and ACLs', async () => fixture(async db => {
  await db.exec(`INSERT INTO public.characters VALUES (1,' Eldrin ',37),(2,'Éldrin',9)`);
  const before = await rows(db), privileges = await metadata(db);
  await install(db);
  assert.deepEqual(await rows(db),before); assert.deepEqual(await metadata(db),privileges);
  const [index] = (await db.query(`SELECT indisunique,indisvalid,indpred IS NULL AS global FROM pg_index WHERE indexrelid='public.characters_creation_name_key_uq'::regclass`)).rows;
  assert.deepEqual(index,{indisunique:true,indisvalid:true,global:true});
}));
test('case/trim conflict globally across all rows; accent distinct; UPDATE is fenced', async () => fixture(async db => {
  await install(db);
  await db.exec(`INSERT INTO public.characters VALUES(1,'Eldrin',1),(2,'Éldrin',1),(3,'Different',1)`);
  for (const name of ['ELDRIN','eldrin',' Eldrin ','ÉLDRIN'])
    await assert.rejects(db.query('INSERT INTO public.characters VALUES(4,$1,1)',[name]),/duplicate key/);
  await assert.rejects(db.exec(`UPDATE public.characters SET name='ELDRIN' WHERE id=3`),/duplicate key/);
  assert.equal((await rows(db))[0].name,'Eldrin');
}));
test('Nordic and accented case pairs use locale lower without stripping accents', async () => fixture(async db => {
  await install(db);
  for (const [id,a,b] of [[1,'Æ','æ'],[2,'Ø','ø'],[3,'Å','å'],[4,'É','é']]) {
    await db.query('INSERT INTO public.characters VALUES($1,$2,1)',[id,a]);
    await assert.rejects(db.query('INSERT INTO public.characters VALUES(20,$1,1)',[b]),/duplicate key/);
  }
  await db.exec(`INSERT INTO public.characters VALUES(5,'E',1)`);
}));
for (const [label,values,pattern] of [
  ['case collision',"(1,'Eldrin',37),(2,'ELDRIN',9)",/collisions/],
  ['trim collision',"(1,' Eldrin ',37),(2,'eldrin',9)",/collisions/],
  ['null',"(1,NULL,37)",/null\/blank/], ['blank',"(1,'   ',37)",/null\/blank/]
]) test(`${label} preflight refuses without changing existing data`, async () => fixture(async db => {
  await db.exec('INSERT INTO public.characters VALUES '+values);
  const before=await rows(db); await assert.rejects(install(db),pattern);
  assert.deepEqual(await rows(db),before);
  assert.equal((await db.query("SELECT to_regclass('public.characters_creation_name_key_uq') AS idx")).rows[0].idx,null);
}));
test('unsupported C input lower refuses rather than falling back to ASCII', async () => fixture(async db => {
  await db.exec("INSERT INTO public.characters VALUES(1,'Eldrin',37)");
  const before=await rows(db); await assert.rejects(install(db),/comparisons failed/);
  assert.deepEqual(await rows(db),before);
}, 'COLLATE "C"'));
test('pre-existing same-name index is not silently accepted or replaced', async () => fixture(async db => {
  await db.exec('CREATE INDEX characters_creation_name_key_uq ON public.characters(level)');
  await assert.rejects(install(db),/already exists/);
  assert.match((await db.query("SELECT pg_get_indexdef('public.characters_creation_name_key_uq'::regclass) AS def")).rows[0].def,/\(level\)/);
}));
test('prepared hosted preflight returns aggregates and compares actual column collation', async () => fixture(async db => {
  await db.exec("INSERT INTO public.characters VALUES(1,'Eldrin',1),(2,'ELDRIN',1)");
  const [{collation}]=(await db.query(`SELECT attcollation::regcollation::text AS collation FROM pg_attribute WHERE attrelid='public.characters'::regclass AND attname='name'`)).rows;
  const result=await db.exec(preflight.replaceAll('__ACTUAL_NAME_COLLATION__',collation));
  const comparisons=result.find(r=>r.rows?.[0]?.label);
  for(const r of comparisons.rows) if(r.required_expected!==null) assert.equal(r.actual_equal,r.required_expected);
  const collisions=result.find(r=>r.rows?.[0]?.collision_groups!==undefined).rows[0];
  assert.equal(Number(collisions.collision_groups),1); assert.equal(Number(collisions.affected_rows),2);
}));
