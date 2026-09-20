import {describe,expect,it} from 'vitest';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const base=JSON.parse(readFileSync('docs/operations/project-state.json','utf8'));
function check(mutator:(state:any)=>void){const dir=mkdtempSync(join(tmpdir(),'wov-state-'));const state=structuredClone(base);mutator(state);
 const source=join(dir,'state.json');writeFileSync(source,JSON.stringify(state));return spawnSync(process.execPath,['scripts/project-state.mjs','--state',source,'--output',join(dir,'state.md')],{encoding:'utf8'});}
describe('project-state validation',()=>{
 it('rejects invalid status, SHA and credential-shaped fields',()=>{
  expect(check(s=>{s.repository.status='released';}).status).toBe(1);
  expect(check(s=>{s.repository.sha='short';}).status).toBe(1);
  expect(check(s=>{s.api_token='nope';}).status).toBe(1);
 });
 it('requires evidence for installed, deployed and manually published states',()=>{
  expect(check(s=>{s.database_migrations[0].status='installed';}).status).toBe(1);
  expect(check(s=>{s.edge_function_deployments[0].status='deployed';}).status).toBe(1);
  expect(check(s=>{s.frontend_publication.status='manually_published';}).status).toBe(1);
 });
 it('rejects duplicate migration identities',()=>{
  expect(check(s=>{s.database_migrations[1].identity=s.database_migrations[0].identity;}).status).toBe(1);
 });
});
