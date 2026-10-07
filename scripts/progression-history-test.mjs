/** Run frozen E release assertions after F supersedes its browser/Edge source.
 * Existing E operation tests use an owner-only behavior fixture with only the pause gate omitted.
 * The installed public entry and its control remain paused for the entire test run.
 * No hosted connection; no production SQL or historical manifest is rewritten.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {read,definition,payload} from './prepare-progression-001E.mjs';
const allowed=['progression-001E-sql.test.mjs','progression-001E-R1-assertion.test.mjs','progression-001E-R2-sql.test.mjs','progression-001F-audit.test.mjs'];
const name=process.argv[2];if(!allowed.includes(name)||!process.argv[3])throw Error('Supply a known historical test and pinned local PGlite module path');
let source=read('scripts/'+name);
const checkpoint='448883efbbb5887e0033e4c987d153dfb8bfb7b3';
source=source.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])(\.\/[^'"]+)\2/g,(_match,imports,_quote,path)=>
 `import {${imports.replace(/\bread\b/,'read as historyFileRead')}} from ${JSON.stringify(pathToFileURL(resolve('scripts',path)).href)}`);
source=`import {execFileSync as historyGit} from 'node:child_process';
const read=path=>path.startsWith('src/')||path.startsWith('supabase/functions/')||path==='supabase/config.toml'
 ?historyGit('git',['show','${checkpoint}:'+path],{encoding:'utf8'}).replaceAll('\\r\\n','\\n'):historyFileRead(path);
`+source;
if(name==='progression-001E-sql.test.mjs'){
 const pause=" IF NOT (SELECT enabled FROM public.progression_command_control WHERE singleton)\n THEN RETURN jsonb_build_object('kind','refused','reason','commands_paused'); END IF;";
 const original=definition(payload(),'progression_command').sql;
 if(original.split(pause).length!==2)throw Error('E paused behavior fixture anchor drift');
 const fixture=original.replace('public.progression_command(','public.progression_command_fixture_owner_only(').replace(pause,'')+
  '\nREVOKE ALL ON FUNCTION public.progression_command_fixture_owner_only(uuid,uuid,uuid,numeric,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role,custom_default;';
 source=source.replace("SELECT progression_command($1,$2,$3,$4,$5,$6,$7) r","SELECT progression_command_fixture_owner_only($1,$2,$3,$4,$5,$6,$7) r");
 source=source.replace("assert.equal((await command(existing)).reason,'commands_paused');",`assert.equal((await q("SELECT progression_command($1,$2,$3,0,'allocate','{\\\"str\\\":1}',NULL) r",[existing,actor,uid()]))[0].r.reason,'commands_paused');`);
 source=source.replace("await db.exec('UPDATE progression_command_control SET enabled=true');",()=>`await db.exec(${JSON.stringify(fixture)});`);
 source=source.replace("))[0].r.kind,'committed');", "))[0].r.reason,'commands_paused');");
 // The sole public service assertion above is the only matching role(...) suffix.
 const marker="test('replay survives paused activation";
 const start=source.indexOf(marker),end=source.indexOf("test('no ordinary",start);
 const block=source.slice(start,end).replace(/await command\(/g,'await publicPausedCommand(')
  .replace("await publicPausedCommand(id,'allocate',{str:1},null,0,event);","await command(id,'allocate',{str:1},null,0,event);")
  .replace('UPDATE progression_command_control SET enabled=true; ','');
 source=source.slice(0,start)+block+source.slice(end);
 source=source.replace('let db,n=1;',`const publicPausedCommand=async(id,op,alloc,target,version,event=uid())=>(await q('SELECT progression_command($1,$2,$3,$4,$5,$6,$7) r',[id,actor,event,version,op,alloc,target]))[0].r;\nlet db,n=1;`);
 source=source.replace('after(async()=>await db?.close());',"after(async()=>{if(db){assert.equal((await q('SELECT enabled FROM progression_command_control'))[0].enabled,false);await db.close();}});");
 source=source.replace('await db.exec(injected);',"await db.exec(injected.replace('public.progression_command(', 'public.progression_command_fixture_owner_only('));");
 source=source.replaceAll('UPDATE progression_command_control SET enabled=true; ','');
 if(source.includes('SET enabled=true'))throw Error('Historical fixture would activate command control: '+source.match(/.{0,30}SET enabled=true.{0,50}/g));
}
process.argv[2]=process.argv[3];
source=source.replaceAll("import.meta.resolve('vite')",JSON.stringify(import.meta.resolve('vite')));
const generated=resolve('../001C-local-db-tests/generated-history-'+name);writeFileSync(generated,source);
await import(pathToFileURL(generated).href);
