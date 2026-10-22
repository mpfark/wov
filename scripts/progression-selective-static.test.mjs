import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidate} from './prepare-progression-selective.mjs';
const sql=readFileSync('docs/operations/progression-selective-activation.sql','utf8').replaceAll('\r\n','\n');
test('reviewed candidate is reproducible and does not register migration history or activation',()=>{
 assert.equal(sql,candidate());
 assert(!/^(BEGIN|COMMIT);/m.test(sql));
 assert(!/\b(?:GRANT|REVOKE|CREATE TABLE|DROP FUNCTION|UPDATE public\.progression_command_control)\b/.test(sql));
 for(const flag of ['join_enabled','allocation_enabled','respec_enabled'])assert(sql.includes(`ADD COLUMN ${flag} boolean NOT NULL DEFAULT false`));
});
test('exact replay remains ahead of pause and selective checks; locks precede character',()=>{
 const replay=sql.indexOf("'kind','replayed'");
 assert(replay<sql.indexOf("'reason','commands_paused'"));
 assert(replay<sql.indexOf("'reason','operation_disabled'"));
 assert(sql.indexOf('WHERE node_id=initial_node ORDER BY id FOR UPDATE')<sql.indexOf('SELECT * INTO c FROM public.characters WHERE id=_character FOR UPDATE'));
 assert(sql.includes("_operation IN('switch','renown')"));
 assert(sql.includes("'switch',false,'renown',false"));
});
