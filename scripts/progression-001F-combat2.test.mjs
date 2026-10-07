/** Actual five-layer Combat2 chain with E and the prepared F authority installed in a disposable fixture.
 * Command control stays false. pgcrypto fixture limitation is identical to the F authority suite.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {read} from './prepare-progression-001E.mjs';
import {payload} from './prepare-progression-001F.mjs';
let outer=read('scripts/progression-001E-combat2.test.mjs')
 .replace("'./prepare-progression-001E.mjs'",JSON.stringify(pathToFileURL(resolve('scripts/prepare-progression-001E.mjs')).href));
const hmac=read('scripts/progression-001F-sql.test.mjs').match(/const hmacFixture=`([\s\S]*?)`;/)[1];
const sql=payload().replace(/IF NOT EXISTS\(SELECT 1 FROM pg_extension WHERE extname='pgcrypto'[^\n]*\)\n OR /,'IF ');
const addition="await db.exec(ePayload());await db.exec('ALTER TABLE characters ADD rp_total_earned integer NOT NULL DEFAULT 0');"+
 `await db.exec(${JSON.stringify(hmac)});await db.exec(${JSON.stringify(sql)});`;
const tests=`
test('001F installed containment preserves actual canonical XP/gold chain and awards no RP',async()=>{
 const f=await fixture({level:29,bhp:1000},42050);const result=await commit(f);assert.equal(result.ok,true);
 const c=await character(f);assert.equal(c.level,30);assert.equal(c.bhp,1000);assert.equal(c.rp_total_earned,0);
 assert.equal((await db.query('SELECT enabled FROM progression_command_control')).rows[0].enabled,false);
});
`;
outer=outer.replace("await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));",()=>
 `source=source.replace('await db.exec(ePayload());',()=>${JSON.stringify(addition)});\nsource+=${JSON.stringify(tests)};\nawait import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));`);
await import('data:text/javascript;base64,'+Buffer.from(outer).toString('base64'));
