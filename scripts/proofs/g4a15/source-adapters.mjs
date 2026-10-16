// LOCAL / NON-DEPLOYABLE. Complete selected source functions/handlers only.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root=new URL('../../../',import.meta.url),hash=s=>createHash('sha256').update(s).digest('hex');
const pins={
 'src/components/admin/CreatureManager.tsx':'a68d65392e6de47679f560a6e2c50a16f331629e403aa1505308137398c9c7ef',
 'src/components/admin/NodeEditorPanel.tsx':'66ae082d88354d25478a45f3f9d8364fb76c0c8d3b5e86011b53e2f7d3da4a00',
 'src/components/admin/PopulatePanel.tsx':'2e5abec565a64ab7b61725f52f5736ca5147ef743d1d1a8cebeceffae501d41e',
 'src/components/admin/boss-cast-form.ts':'06683cbd43a7c637a8b1228243da8ddfc7ae998b572554b150ae7a995feb72af',
 'src/shared/combat2/boss-catalog.ts':'5d9fada72e210a9a5fb8603a677399e1cc2ad6372f5ca8fc51115fa76eaafa6c',
 'src/shared/combat/c3/boss-cast-contract.ts':'f74b148739cf574e5a4f6cfc3c327c93612744f633caa889f780a2ce559a592e',
 'src/shared/formulas/creatures.ts':'193c8d32756bdfd25eff0ee01f16e8a7e82c99f315f5bf59367d91b8eedd544e',
 'supabase/migrations/20260215091228_fce1ea0c-a649-4361-959e-c677e1011267.sql':'a331a8ae18e7db96598f20b1c41895d76aea154573834112d5d570e51f4ed359',
 'supabase/migrations/20260211212345_41f57ff6-5254-4fb2-99cf-eccf43f00fc5.sql':'9ef011b1bc3489b2ddc787e0fe5d49f0bf4aee3c9651a09267ad1684e1550cbc',
 'supabase/migrations/20260915200000_combat2_authoritative_reward_channels.sql':'0e485d69a6a6c3cdff6aba492ff301f95fd93609ba0bdf1f1e5e60b859eb4fcc'};
export const manifest=[];
export function load(p){assert(pins[p],p+' not pinned');const s=fs.readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');assert.equal(hash(s),pins[p],p+' drift');return s;}
const adapt=s=>s.replaceAll('_role app_role','_role g4a6.app_role').replaceAll('public.','g4a6.').replaceAll('auth.uid()','g4a9.actor_uid()').replaceAll('SECURITY DEFINER','SECURITY INVOKER').replace(/SET search_path\s*=\s*public(?:,pg_temp)?/g,'SET search_path=pg_catalog,g4a6,pg_temp').replace(/\bnow\(\)/g,'g4a6.test_now()');
function fn(p,name){const s=load(p),m=s.match(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.'+name+'\\('));assert(m,name);const tail=s.slice(m.index),d=tail.match(/\bAS\s+(\$\w*\$)/i)[1],a=tail.indexOf(d),b=tail.indexOf(d,a+d.length),def=tail.slice(0,b+d.length)+';';manifest.push({path:p,fileLfSha256:pins[p],identity:name,definitionSha256:hash(def),adaptedSha256:hash(adapt(def))});return adapt(def);}
export function buildAdminSource(){const paths=Object.keys(pins),roles=paths[7],base=paths[8],reward=paths[9];
 let sql="DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_g4a14_g4a15_%' THEN RAISE EXCEPTION 'disposable fixture only'; END IF; END $$;\n";
 sql+=fn(base,'has_role')+fn(roles,'is_steward_or_overlord')+fn(reward,'validate_creature_reward_config');
 const table=load(reward).match(/CREATE TABLE public.admin_creature_reward_request\([^;]+;/)[0];sql+=adapt(table);
 sql+=fn(reward,'admin_set_creature_rewards');
 sql+=adapt(load(reward).match(/CREATE TRIGGER creature_reward_validate[^;]+;/)[0]);return sql+'\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;';
}
const cache=new Map();
export function moduleSource(p){if(cache.has(p))return cache.get(p);const out={};cache.set(p,out);const code=ts.transpileModule(load(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports','require',code)(out,id=>{assert(id.startsWith('@/'),id);return moduleSource('src/'+id.slice(2)+'.ts');});return out;}
export function handler(p,name,env){const text=load(p),sf=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(sf)===name){assert(!found,'ambiguous handler');found=n.initializer.getText(sf);}if(ts.isFunctionDeclaration(n)&&n.name?.text===name){assert(!found,'ambiguous function');found=n.getText(sf);}ts.forEachChild(n,visit);}visit(sf);assert(found,name);manifest.push({path:p,fileLfSha256:pins[p],identity:name,initializerSha256:hash(found)});const code=ts.transpileModule('const run='+found+'; run;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;return new Function(...Object.keys(env),code.replace(/run;\s*$/,'return run;'))(...Object.values(env));}
