/** Disposable PGlite 0.3.14 only. No connection strings, hosted calls or production fixtures.
 * node scripts/progression-001G-C2-P1-B-sql.test.mjs <local-pglite-dist/index.js>
 * Exact migration bytes execute inside explicit transactions; no lifecycle RPC is implemented.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { columns, protectedColumns, unprotectedColumns, browserColumns } from './prepare-progression-001F-R1.mjs';

if (!process.argv[2]) throw new Error('Supply the local PGlite module path; no network/database URL mode');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const migrationPath = 'drizzle/migrations/0007_progression_001g_c2_private_creation_storage.sql';
const migration = readFileSync(migrationPath, 'utf8');
const origin = 'public.character_creation_origin', log = 'public.character_creation_log';
const guard = 'public.character_creation_storage_guard()';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = uuid(1), target = uuid(2), character = uuid(3), logId = uuid(4), request = uuid(5);
let db, beforeInstall, next = 10;
const q = async (sql, values = []) => (await db.query(sql, values)).rows;
async function rollback(fn) {
  await db.exec('BEGIN');
  try { await fn(); } finally { await db.exec('ROLLBACK'); }
}
async function refused(sql, values = [], pattern = /constraint|immutable|expiry|exists|transition|permission denied/) {
  await db.exec('SAVEPOINT refused');
  try { await assert.rejects(db.query(sql, values), pattern); }
  finally { await db.exec('ROLLBACK TO SAVEPOINT refused; RELEASE SAVEPOINT refused'); }
}
const retirement = `actor_id=NULL,request_id=NULL,target_account_id=NULL,
  result_character_id=NULL,payload_version=NULL,payload_digest=NULL,replay_status='retired'`;
async function insertOrigin(id = character) {
  await db.query(`INSERT INTO ${origin} VALUES ($1,1,'creation-v1','race-v1','class-v1','formula-v1',$2,'2026-10-09T00:00:00Z')`,
    [id, { initial: { level: 1, xp: 0, gold: 200, family: null, inventory: [], equipment: [] } }]);
}
async function insertLog({ id = logId, intent = request, result = character, creator = actor,
  owner = target, time = '2026-10-09T00:00:00Z', details = { mode: 'delegated', reason: 'fixture recovery', actor, target } } = {}) {
  await db.query(`INSERT INTO ${log} (log_id,actor_id,request_id,target_account_id,
    result_character_id,payload_version,payload_digest,replay_status,created_at,details_expires_at,detailed_receipt)
    VALUES ($1,$2,$3,$4,$5,1,$6,'applied',$7,
      (($7::timestamptz AT TIME ZONE 'UTC')+interval '12 months') AT TIME ZONE 'UTC',$8)`,
    [id, creator, intent, owner, result, new Uint8Array(32).fill(17), time, details]);
}
async function existingSnapshot() {
  return {
    characters: await q('SELECT to_jsonb(c) v FROM public.characters c ORDER BY id'),
    materials: await q('SELECT to_jsonb(m) v FROM public.character_materials m ORDER BY character_id'),
    metadata: await q(`SELECT to_jsonb(c) v FROM pg_class c WHERE c.oid IN
      ('public.characters'::regclass,'public.character_materials'::regclass) ORDER BY c.oid`),
    grants: await q(`SELECT attrelid,attnum,attacl FROM pg_attribute WHERE attrelid IN
      ('public.characters'::regclass,'public.character_materials'::regclass) ORDER BY attrelid,attnum`),
    triggers: await q(`SELECT to_jsonb(t) v FROM pg_trigger t WHERE NOT tgisinternal AND tgrelid IN
      ('public.characters'::regclass,'public.character_materials'::regclass) ORDER BY oid`),
  };
}
const fixture = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  CREATE ROLE custom_default; CREATE ROLE app_bridge; CREATE ROLE app_leaf BYPASSRLS;
  GRANT authenticated TO app_bridge; GRANT app_bridge TO app_leaf;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE TABLE public.characters(${columns.map(c => c === 'id' ? 'id uuid PRIMARY KEY' : c === 'user_id'
    ? 'user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE' : `${c} ${c === 'name' ? 'text' : 'integer'}`).join(',')});
  CREATE TABLE public.character_materials(character_id uuid PRIMARY KEY, amount integer);
  CREATE FUNCTION public.fixture_starting_materials() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO public.character_materials VALUES(NEW.id,40); RETURN NEW; END $$;
  CREATE TRIGGER fixture_starting_materials AFTER INSERT ON public.characters
    FOR EACH ROW EXECUTE FUNCTION public.fixture_starting_materials();
  GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role,app_leaf,custom_default;
  GRANT SELECT ON public.characters TO authenticated,service_role;
  GRANT UPDATE(${unprotectedColumns.join(',')}) ON public.characters TO service_role;
  GRANT UPDATE(${browserColumns.join(',')}) ON public.characters TO authenticated;
  INSERT INTO auth.users VALUES('${actor}'),('${target}');
  INSERT INTO public.characters(id,user_id,name,level,xp,gold,str)
    VALUES('${character}','${target}','Unchanged Legacy',37,12345,789,42);
  -- Exercise actual default ACL closure for standard and nonstandard grantees.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO PUBLIC,anon,authenticated,service_role,custom_default;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role,custom_default;
`;

before(async () => {
  db = new PGlite();
  await db.exec(fixture);
  beforeInstall = await existingSnapshot();
  await db.exec('BEGIN');
  try { await db.exec(migration); await db.exec('COMMIT'); }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
});
after(async () => { await db?.close(); });

test('01 exact migration installs only two empty tables, one invoker guard and two UPDATE triggers', async () => {
  assert.deepEqual(await q(`SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relkind='r' AND relname LIKE 'character_creation_%' ORDER BY relname`),
    [{ relname: 'character_creation_log' }, { relname: 'character_creation_origin' }]);
  for (const table of [origin, log]) assert.equal((await q(`SELECT count(*)::int n FROM ${table}`))[0].n, 0);
  assert.deepEqual(await q(`SELECT p.prosecdef,p.proconfig,p.proowner='postgres'::regrole AS owner
    FROM pg_proc p WHERE p.oid=$1::regprocedure`, [guard]),
    [{ prosecdef: false, proconfig: ['search_path=pg_catalog'], owner: true }]);
  assert.deepEqual((await q(`SELECT tgtype,tgenabled FROM pg_trigger
    WHERE tgrelid IN ($1::regclass,$2::regclass) AND NOT tgisinternal ORDER BY tgrelid`, [origin, log]))
    .map(t => [t.tgtype, t.tgenabled]), [[19, 'O'], [19, 'O']]);
  assert.equal((await q(`SELECT count(*)::int n FROM pg_class WHERE relkind='S' AND relnamespace='public'::regnamespace`))[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int n FROM pg_attribute a WHERE attrelid IN ($1::regclass,$2::regclass)
    AND attnum>0 AND (atthasdef OR attidentity<>'' OR attgenerated<>'')`, [origin, log]))[0].n, 0);
  console.log('Local engine:', (await q('SELECT version() v'))[0].v);
});

test('02 installation preserves legacy values, material trigger and service15/38/browser6 privilege partition', async () => {
  assert.deepEqual(await existingSnapshot(), beforeInstall);
  for (const c of columns) {
    assert.equal((await q(`SELECT has_column_privilege('service_role','public.characters',$1,'UPDATE') v`, [c]))[0].v,
      unprotectedColumns.includes(c), c);
    assert.equal((await q(`SELECT has_column_privilege('authenticated','public.characters',$1,'UPDATE') v`, [c]))[0].v,
      browserColumns.includes(c), c);
  }
  assert.equal(protectedColumns.length, 15); assert.equal(unprotectedColumns.length, 38);
  assert.equal((await q(`SELECT has_table_privilege('service_role','public.characters','UPDATE') v`))[0].v, false);
});

test('03 private ACL/RLS denies actual reads and all writes to standard/inherited application roles', async () => {
  for (const role of ['anon', 'authenticated', 'service_role', 'custom_default', 'app_leaf']) {
    for (const table of [origin, log]) {
      assert.equal((await q(`SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') v`, [role, table]))[0].v, false);
      assert.equal((await q(`SELECT has_any_column_privilege($1,$2,'SELECT,INSERT,UPDATE,REFERENCES') v`, [role, table]))[0].v, false);
    }
    assert.equal((await q(`SELECT has_function_privilege($1,$2,'EXECUTE') v`, [role, guard]))[0].v, false);
    await rollback(async () => {
      await db.exec(`SET LOCAL ROLE ${role}`);
      for (const table of [origin, log]) {
        for (const sql of [`SELECT * FROM ${table}`, `INSERT INTO ${table} DEFAULT VALUES`,
          `UPDATE ${table} SET created_at=created_at`, `DELETE FROM ${table}`, `TRUNCATE ${table}`]) {
          await refused(sql, [], /permission denied/);
        }
      }
      await refused(`SELECT ${guard}`, [], /permission denied/);
    });
  }
  assert.deepEqual((await q(`SELECT relowner='postgres'::regrole owner,relrowsecurity,relforcerowsecurity
    FROM pg_class WHERE oid IN ($1::regclass,$2::regclass)`, [origin, log])),
    Array(2).fill({ owner: true, relrowsecurity: true, relforcerowsecurity: false }));
  assert.equal((await q(`SELECT count(*)::int n FROM pg_policy WHERE polrelid IN ($1::regclass,$2::regclass)`, [origin, log]))[0].n, 0);
});

test('04 origin requires four nonempty versions, object snapshot, schema1 and existing UUID character', async () => rollback(async () => {
  await insertOrigin();
  for (const column of ['creation_version', 'race_version', 'class_version', 'formula_version']) {
    await refused(`INSERT INTO ${origin} SELECT character_id,snapshot_schema_version,
      ${['creation_version', 'race_version', 'class_version', 'formula_version'].map(c => c === column ? "'   '" : c).join(',')},
      applied_snapshot,created_at FROM ${origin}`, [], /check constraint/);
  }
  await refused(`INSERT INTO ${origin} SELECT $1,2,creation_version,race_version,class_version,formula_version,
    applied_snapshot,created_at FROM ${origin}`, [uuid(999)], /check constraint/);
  await refused(`INSERT INTO ${origin} SELECT $1,1,creation_version,race_version,class_version,formula_version,
    '[]'::jsonb,created_at FROM ${origin}`, [uuid(999)], /check constraint/);
  await refused(`INSERT INTO ${origin} SELECT $1,1,creation_version,race_version,class_version,formula_version,
    applied_snapshot,created_at FROM ${origin}`, [uuid(999)], /foreign key constraint/);
}));

test('05 every origin UPDATE including no-op refused; FK blocks character and cascading account deletion', async () => rollback(async () => {
  assert.deepEqual(await q(`SELECT confdeltype,confupdtype,condeferrable,convalidated FROM pg_constraint
    WHERE conrelid=$1::regclass AND contype='f'`, [origin]),
    [{ confdeltype: 'r', confupdtype: 'r', condeferrable: false, convalidated: true }]);
  await insertOrigin();
  for (const sql of [`UPDATE ${origin} SET applied_snapshot='{}'`, `UPDATE ${origin} SET creation_version='v2'`,
    `UPDATE ${origin} SET character_id=character_id`]) await refused(sql, [], /origin is immutable/);
  await refused(`DELETE FROM public.characters WHERE id=$1`, [character], /foreign key constraint/);
  await refused(`DELETE FROM auth.users WHERE id=$1`, [target], /foreign key constraint/);
  assert.equal((await q(`SELECT count(*)::int n FROM ${origin}`))[0].n, 1);
}));

test('06 request uniqueness is actor scoped; result UUID cannot have duplicate creation log', async () => rollback(async () => {
  await insertLog();
  await assert.rejects(insertLog({ id: uuid(next++), result: uuid(next++) }), /unique constraint/);
  // Each expected failure gets a savepoint so the rest of the transaction can proceed.
}));

test('07 ordinary uniqueness permits distinct actor/same request and fully retired rows', async () => rollback(async () => {
  await insertLog();
  await insertLog({ id: uuid(next++), creator: target, result: uuid(next++) });
  await refused(`INSERT INTO ${log} SELECT $1,actor_id,$2,target_account_id,result_character_id,
    payload_version,payload_digest,replay_status,created_at,details_expires_at,detailed_receipt
    FROM ${log} WHERE log_id=$3`, [uuid(next++), uuid(next++), logId], /unique constraint/);
  for (let i = 0; i < 2; i++) await db.query(`INSERT INTO ${log}
    (log_id,replay_status,created_at,details_expires_at) VALUES($1,'retired','2020-01-01Z','2021-01-01Z')`, [uuid(next++)]);
}));

test('08 null-safe replay groups, status, digest, receipt shape and payload version constraints', async () => rollback(async () => {
  await insertLog();
  // Clone rather than UPDATE, so CHECK constraints are exercised independently of guards.
  const fields = ['actor_id','request_id','target_account_id','result_character_id','payload_version','payload_digest'];
  for (const column of fields) {
    await refused(`INSERT INTO ${log} SELECT $1,${fields.map(c => c === column ? 'NULL' : c).join(',')},
      replay_status,created_at,details_expires_at,detailed_receipt FROM ${log}`, [uuid(next++)], /check constraint/);
  }
  for (const [column, value] of [['replay_status', "'unknown'"], ['replay_status', "'retired'"],
    ['payload_version', '2'], ['payload_digest', "decode('00','hex')"], ['detailed_receipt', "'null'::jsonb"]]) {
    const names = ['actor_id','request_id','target_account_id','result_character_id','payload_version','payload_digest',
      'replay_status','created_at','details_expires_at','detailed_receipt'];
    await refused(`INSERT INTO ${log} SELECT $1,${names.map(c => c === column ? value : c).join(',')}
      FROM ${log}`, [uuid(next++)], /check constraint/);
  }
}));

test('09 UTC twelve-calendar-month expiry handles leap/month-end and refuses infinite or shifted retention', async () => rollback(async () => {
  await db.exec("SET LOCAL TIME ZONE 'Pacific/Auckland'");
  await insertLog({ time: '2024-02-29T23:30:00Z' });
  assert.equal((await q(`SELECT to_char(details_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') v FROM ${log}`))[0].v, '2025-02-28 23:30:00');
  for (const [time, expiry] of [['2024-01-31T01:00:00Z', '2025-01-30T01:00:00Z'], ['infinity','infinity'], ['-infinity','-infinity']]) {
    await refused(`INSERT INTO ${log} (log_id,replay_status,created_at,details_expires_at)
      VALUES($1,'retired',$2,$3)`, [uuid(next++), time, expiry], /check constraint/);
  }
}));

test('10 bindings/timestamps and audit cannot be rewritten, extended or cleared before expiry', async () => rollback(async () => {
  await insertLog({ time: '2099-01-01T00:00:00Z' });
  for (const [column, value] of [['log_id', `'${uuid(99)}'`], ['actor_id', `'${target}'`], ['request_id', `'${uuid(99)}'`],
    ['target_account_id', `'${actor}'`], ['result_character_id', `'${uuid(99)}'`], ['payload_version','2'],
    ['payload_digest', "decode(repeat('22',32),'hex')"], ['created_at', "created_at+interval '1 second'"],
    ['details_expires_at', "details_expires_at+interval '1 second'"], ['detailed_receipt', "'{}'::jsonb"], ['detailed_receipt','NULL']]) {
    await refused(`UPDATE ${log} SET ${column}=${value}`, [], /immutable|only be cleared/);
  }
}));

test('11 clearing expired detail keeps exact replay data and forbids adding history again', async () => rollback(async () => {
  await insertLog({ time: '2020-01-31T12:00:00Z' });
  const previous = (await q(`SELECT * FROM ${log}`))[0];
  await db.exec(`UPDATE ${log} SET detailed_receipt=NULL`);
  assert.deepEqual((await q(`SELECT * FROM ${log}`))[0], { ...previous, detailed_receipt: null });
  await refused(`UPDATE ${log} SET detailed_receipt='{}'`, [], /only be cleared/);
  await refused(`UPDATE ${log} SET replay_status='retired',${fieldsToNullExceptActor()}`, [], /actor still exists/);
}));
function fieldsToNullExceptActor() {
  return 'request_id=NULL,target_account_id=NULL,result_character_id=NULL,payload_version=NULL,payload_digest=NULL';
}

test('12 exact deadline permits expiry and empty expired log remains replay-protected', async () => rollback(async () => {
  await db.exec(`INSERT INTO ${log} (log_id,actor_id,request_id,target_account_id,result_character_id,payload_version,
    payload_digest,replay_status,created_at,details_expires_at,detailed_receipt)
    SELECT '${logId}','${actor}','${request}','${target}','${character}',1,decode(repeat('11',32),'hex'),'applied',
      (statement_timestamp() AT TIME ZONE 'UTC' - interval '12 months') AT TIME ZONE 'UTC',statement_timestamp(),'{}';
    UPDATE ${log} SET detailed_receipt=NULL;`);
  assert.equal((await q(`SELECT replay_status FROM ${log}`))[0].replay_status, 'applied');
}));

test('13 result purge is terminal, preserves replay/history and requires result absence', async () => rollback(async () => {
  await insertOrigin(); await insertLog();
  await refused(`UPDATE ${log} SET replay_status='purged'`, [], /result still exists/);
  await db.exec(`DELETE FROM ${origin}; DELETE FROM public.characters WHERE id='${character}';
    UPDATE ${log} SET replay_status='purged';`);
  assert.equal((await q(`SELECT detailed_receipt IS NOT NULL details FROM ${log}`))[0].details, true);
  await refused(`UPDATE ${log} SET replay_status='applied'`, [], /invalid.*transition/);
  await refused(`UPDATE ${log} SET result_character_id=$1`, [uuid(99)], /immutable/);
}));

test('14 delegated actor deletion retires only replay fields and preserves recipient origin and unexpired audit', async () => rollback(async () => {
  await insertOrigin(); await insertLog({ time: '2099-01-01T00:00:00Z' });
  const original = await q(`SELECT * FROM ${origin}`), detail = (await q(`SELECT detailed_receipt FROM ${log}`))[0].detailed_receipt;
  await refused(`UPDATE ${log} SET ${retirement}`, [], /actor still exists/);
  await db.query('DELETE FROM auth.users WHERE id=$1', [actor]);
  await refused(`UPDATE ${log} SET replay_status='retired'`, [], /check constraint/);
  await db.exec(`UPDATE ${log} SET ${retirement}`);
  assert.deepEqual(await q(`SELECT * FROM ${origin}`), original);
  const row = (await q(`SELECT * FROM ${log}`))[0];
  for (const c of ['actor_id','request_id','target_account_id','result_character_id','payload_version','payload_digest']) assert.equal(row[c], null);
  assert.deepEqual(row.detailed_receipt, detail);
  await refused(`UPDATE ${log} SET replay_status='applied'`, [], /invalid.*transition/);
  await refused(`UPDATE ${log} SET detailed_receipt=NULL`, [], /only be cleared/);
}));

test('15 deleted target leaves living delegated actor replay until controlled actor deletion', async () => rollback(async () => {
  await insertOrigin(); await insertLog({ time: '2020-01-01T00:00:00Z' });
  await db.exec(`DELETE FROM ${origin}; DELETE FROM auth.users WHERE id='${target}';
    UPDATE ${log} SET replay_status='purged'; UPDATE ${log} SET detailed_receipt=NULL;`);
  assert.equal((await q(`SELECT actor_id FROM ${log}`))[0].actor_id, actor);
  await refused(`UPDATE ${log} SET ${retirement}`, [], /actor still exists/);
  await db.query('DELETE FROM auth.users WHERE id=$1', [actor]);
  await db.exec(`UPDATE ${log} SET ${retirement}; DELETE FROM ${log} WHERE replay_status='retired' AND detailed_receipt IS NULL;`);
  assert.equal((await q(`SELECT count(*)::int n FROM ${log}`))[0].n, 0);
}));

test('16 controlled result/origin/log lifecycle rolls back atomically on outer failure', async () => rollback(async () => {
  await insertOrigin(); await insertLog();
  const oldOrigin = await q(`SELECT * FROM ${origin}`), oldLog = await q(`SELECT * FROM ${log}`);
  await db.exec('SAVEPOINT lifecycle');
  await db.exec(`DELETE FROM ${origin}; DELETE FROM public.characters WHERE id='${character}';
    UPDATE ${log} SET replay_status='purged';`);
  await db.exec('ROLLBACK TO SAVEPOINT lifecycle; RELEASE SAVEPOINT lifecycle');
  assert.deepEqual(await q(`SELECT * FROM ${origin}`), oldOrigin); assert.deepEqual(await q(`SELECT * FROM ${log}`), oldLog);
  assert.equal((await q('SELECT count(*)::int n FROM public.characters'))[0].n, 1);
}));

test('17 application global authority and transitive postgres membership abort and roll back entire migration', async () => {
  for (const drift of ['GRANT pg_read_all_data TO authenticated', 'GRANT pg_write_all_data TO service_role',
    'GRANT pg_read_all_data TO app_leaf', 'GRANT postgres TO app_bridge', 'ALTER ROLE anon SUPERUSER']) {
    const isolated = new PGlite();
    try {
      await isolated.exec(fixture); await isolated.exec(drift); await isolated.exec('BEGIN');
      await assert.rejects(isolated.exec(migration), /effective application privilege leak|guard privilege leak/);
      await isolated.exec('ROLLBACK');
      assert.equal((await isolated.query(`SELECT to_regclass('public.character_creation_origin') absent`)).rows[0].absent, null);
    } finally { await isolated.close(); }
  }
});

test('18 independent platform global reader does not become a false application leak', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(fixture);
    await isolated.exec('CREATE ROLE platform_reader BYPASSRLS; CREATE ROLE platform_bridge; GRANT pg_read_all_data TO platform_bridge; GRANT platform_bridge TO platform_reader; BEGIN;');
    await isolated.exec(migration); await isolated.exec('COMMIT');
    assert.equal((await isolated.query(`SELECT has_table_privilege('platform_reader','${origin}','SELECT') v`)).rows[0].v, true);
    assert.equal((await isolated.query(`SELECT count(*)::int n FROM pg_class c,LATERAL aclexplode(c.relacl) a
      WHERE c.oid='${origin}'::regclass AND a.grantee='platform_reader'::regrole`)).rows[0].n, 0);
  } finally { await isolated.close(); }
});

test('19 namespace conflicts and replayed installation fail closed without changing existing storage', async () => rollback(async () => {
  await db.exec('SAVEPOINT repeated_install');
  await assert.rejects(db.exec(migration), /namespace conflict/);
  await db.exec('ROLLBACK TO SAVEPOINT repeated_install; RELEASE SAVEPOINT repeated_install');
  assert.equal((await q(`SELECT count(*)::int n FROM ${origin}`))[0].n, 0);
}));

test('20 final table/function ACL assertions fail closed with full migration rollback', async () => {
  for (const extra of [`GRANT SELECT ON ${origin} TO authenticated;`, `GRANT EXECUTE ON FUNCTION ${guard} TO authenticated;`]) {
    const isolated = new PGlite();
    try {
      await isolated.exec(fixture); await isolated.exec('BEGIN');
      await assert.rejects(isolated.exec(migration.replace('DO $assert_private$', `${extra}\nDO $assert_private$`)),
        /direct ACL drift|guard privilege leak/);
      await isolated.exec('ROLLBACK');
      assert.equal((await isolated.query(`SELECT to_regclass('${origin}') absent`)).rows[0].absent, null);
      assert.equal((await isolated.query(`SELECT to_regprocedure('${guard}') absent`)).rows[0].absent, null);
    } finally { await isolated.close(); }
  }
});

test('21 storage SQL excludes gameplay writers and preserves historical migration prefix', () => {
  assert.doesNotMatch(migration, /CREATE\s+(?:OR REPLACE\s+)?FUNCTION[^;]*(?:creation_rpc|create_character)/i);
  assert.doesNotMatch(migration, /CREATE\s+COLLATION|CREATE\s+EXTENSION|CREATE\s+SEQUENCE|\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE\s+TABLE)|GRANT\s|CREATE\s+UNIQUE\s+INDEX\s+.*characters/i);
  assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'supabase/migrations', 'drizzle/migrations/meta'], { encoding: 'utf8' }).trim(), '');
  assert.equal(execFileSync('git', ['diff', '--name-only', 'HEAD', '--', ...Array.from({ length: 7 }, (_, i) => {
    const entry = JSON.parse(readFileSync('drizzle/migrations/meta/_journal.json', 'utf8')).entries[i];
    return `drizzle/migrations/${entry.tag}.sql`;
  })], { encoding: 'utf8' }).trim(), '');
});

test('22 missing/wrong identity dependencies and existing table conflicts fail before changing legacy data', async () => {
  for (const [drift, reason] of [
    ['DROP TABLE auth.users CASCADE', /does not exist/],
    ['ALTER TABLE auth.users ALTER COLUMN id TYPE text USING id::text', /identity dependency drift/],
    [`CREATE TABLE ${origin}(sentinel integer)`, /already exists/],
  ]) {
    const isolated = new PGlite();
    try {
      await isolated.exec(fixture);
      // Remove only the fixture FK so wrong account identity type can be tested.
      if (drift.startsWith('ALTER TABLE')) await isolated.exec('ALTER TABLE public.characters DROP CONSTRAINT characters_user_id_fkey');
      await isolated.exec(drift);
      const unchanged = (await isolated.query('SELECT to_jsonb(c) v FROM public.characters c')).rows;
      await isolated.exec('BEGIN');
      await assert.rejects(isolated.exec(migration), reason);
      await isolated.exec('ROLLBACK');
      assert.deepEqual((await isolated.query('SELECT to_jsonb(c) v FROM public.characters c')).rows, unchanged);
      assert.equal((await isolated.query(`SELECT to_regclass('${log}') absent`)).rows[0].absent, null);
    } finally { await isolated.close(); }
  }
});
