/** Post-install reconciliation; preserves archival F/R1 generators, manifests and all executed SQL. */
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
export const baseline='cd4c109c31f7112bc9c149773a3865e6da501f87';
export const manifestPath='docs/operations/progression-001F-R2-edge-manifest.json';
export const deploymentFiles=['supabase/functions/progression-command/index.ts','supabase/functions/_shared/progression-command.ts'];
const git=(...args)=>execFileSync('git',args);
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>readFileSync(p,'utf8').replaceAll('\r\n','\n');
const installedPath='drizzle/migrations/0006_progression_001f_r1_restore_unprotected_service_updates.sql';
const reviewedPath='docs/operations/progression-001F-R1-service-update-repair.sql';
const identity=b=>({sha256:sha(b),bytes:b.length,lf_lines:b.toString('utf8').split('\n').length-1});
export function manifest(){return {status:'prepared_for_final_edge_deployment_paused_verification',task_start_sha:'031b951408952c799d178b42e449b90caf8191e1',synchronized_source:baseline,platform_commit:'97c1437ce5f88249db19ac0d46c98bc4e290f07a',installed_migration:{path:installedPath,...identity(git('show',baseline+':'+installedPath)),journal_index:6,operator_reported_drizzle_row_id:7},reviewed_artifact:{path:reviewedPath,...identity(readFileSync(reviewedPath))},deployment_files:deploymentFiles.map(path=>({path,...identity(readFileSync(path))})),configuration:{path:'supabase/config.toml',...identity(readFileSync('supabase/config.toml')),progression_command_verify_jwt:false},external_imports:['https://esm.sh/@supabase/supabase-js@2.116.0'],environment_names:['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],runtime:'Deno.serve, Request/Response; provider SDK external transitive dependencies, not repository-local files',commands_paused:true,frontend_published:false};}
export function check(){
 const m=manifest();if(read(manifestPath)!==JSON.stringify(m,null,2)+'\n')throw Error('R2 manifest drift');
 git('merge-base','--is-ancestor',m.task_start_sha,baseline);
 git('merge-base','--is-ancestor',m.platform_commit,baseline);
 if(m.installed_migration.sha256!=='04a15bf91b8f7c629db0676a20de9e4ba06804d75ac62cbd308cce8db99da54f'||m.installed_migration.bytes!==22309||m.installed_migration.lf_lines!==192)throw Error('0006 identity drift');
 if(JSON.stringify(identity(git('show',baseline+':'+installedPath)))!==JSON.stringify(identity(readFileSync(reviewedPath))))throw Error('0006 reviewed identity mismatch');
 const journal=JSON.parse(read('drizzle/migrations/meta/_journal.json'));
 const old=JSON.parse(git('show','031b951408952c799d178b42e449b90caf8191e1:drizzle/migrations/meta/_journal.json'));
 if(journal.entries.length!==7||JSON.stringify(journal.entries.slice(0,6))!==JSON.stringify(old.entries)||journal.entries[6].idx!==6||journal.entries[6].tag!=='0006_progression_001f_r1_restore_unprotected_service_updates'||journal.entries[6].when!==1791404929982)throw Error('Drizzle prefix/progression drift');
 const prev=JSON.parse(read('drizzle/migrations/meta/0005_snapshot.json')),next=JSON.parse(read('drizzle/migrations/meta/0006_snapshot.json'));
 if(next.prevId!==prev.id||next.version!=='7'||next.dialect!=='postgresql'||Object.keys(next.tables).length)throw Error('0006 snapshot chain drift');
 for(const p of [...deploymentFiles,'supabase/config.toml'])if(!readFileSync(p).equals(git('show','b8c18c90b1b5a5532244b76c41568a15986a0cfe:'+p)))throw Error('F Edge closure drift: '+p);
 // Traverse every relative import and refuse any unreviewed external dependency.
 const visited=new Set(),external=new Set();function visit(p){if(visited.has(p))return;visited.add(p);for(const match of read(p).matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){const dep=match[1];if(dep.startsWith('.'))visit(resolve(dirname(p),dep).replaceAll('\\','/'));else external.add(dep);}}
 visit(resolve(deploymentFiles[0]).replaceAll('\\','/'));
 if(JSON.stringify([...visited].sort())!==JSON.stringify(deploymentFiles.map(p=>resolve(p).replaceAll('\\','/')).sort())||JSON.stringify([...external])!==JSON.stringify(m.external_imports))throw Error('Edge import closure drift');
 if(git('diff',baseline,'--','drizzle','supabase/migrations','src','supabase/functions','supabase/config.toml').toString().trim()||git('status','--porcelain','--','drizzle','supabase/migrations').toString().trim())throw Error('R2 history/runtime preservation drift');
 for(const p of ['docs/operations/progression-001F-cutover.sql','docs/operations/progression-001F-manifest.json','docs/operations/progression-001F-R1-service-update-repair.sql','docs/operations/progression-001F-R1-manifest.json','scripts/prepare-progression-001F.mjs','scripts/prepare-progression-001F-R1.mjs','scripts/progression-001F-R1-sql.test.mjs'])if(git('diff',baseline,'--',p).toString().trim())throw Error('R2 historical release drift');
 console.log(JSON.stringify(m,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.includes('--write'))writeFileSync(manifestPath,JSON.stringify(manifest(),null,2)+'\n');
 else if(process.argv.includes('--r1-test')){
  // Only replace the archival pre-0006 prefix checker; every R1 SQL/ACL/DML test runs unchanged.
  let source=read('scripts/progression-001F-R1-sql.test.mjs');
  source=source.replace('read,check,keyEffectiveLeakPredicate','read,check as archivalPreInstallCheck,keyEffectiveLeakPredicate');
  source=source.replace(/from '(\.\/[^']+)'/g,(_m,p)=>`from '${pathToFileURL(resolve('scripts',p)).href}'`);
  source=source.replace("from 'typescript'",`from '${import.meta.resolve('typescript')}'`);
  source=`import {check} from '${import.meta.url}';\n`+source;
  const output=resolve('../001C-local-db-tests/generated-F-R2-R1.test.mjs');writeFileSync(output,source);
  execFileSync(process.execPath,[output,process.argv.at(-1)],{stdio:'inherit'});
 }else check();
}
