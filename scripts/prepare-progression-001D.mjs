/** Deterministic local payload generation only; never executes SQL or a runner. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const evidence=Object.freeze({
 node_tick_commit:[1865,'36edc2dd1d83d3bb9be96af461188ca2f12e8b823741ddfb1e72c74abe0e3489'],
 node_tick_commit_without_character_stances:[1068,'ed8eea68390aa9f910fdbe6b4905d9c41c586c23e3035c3893b5a1afddacb6a6'],
 node_tick_commit_without_authoritative_arrival:[2269,'5c0ca87eb78a403cb615dfc0e0b4d024a66190898efc6957d87c30c2d4e0d2ac'],
 node_tick_commit_without_boss_timing:[1007,'e5a277313c5725d06fb2fea7272347035a703ea7058177f640d16963f7798302'],
 node_tick_commit_without_bounded_failure:[30403,'617a445c2262696e889ab0715785b5463d32c81a067f3d7ca215fffd0ceb3be9'],
});
export const argumentsSql='uuid,uuid,integer,integer,bigint,uuid[],jsonb';
export const evidenceRoot='docs/operations/progression-001D-evidence';
export function verifiedBodies(root=evidenceRoot){
 return Object.fromEntries(Object.entries(evidence).map(([name,[bytes,hash]])=>{
  const b=readFileSync(`${root}/${name}.sql`);const text=b.toString('utf8');
  if(b.length!==bytes||createHash('sha256').update(b).digest('hex')!==hash||!Buffer.from(text,'utf8').equals(b))throw Error(`Evidence mismatch: ${name}`);
  const header=`CREATE OR REPLACE FUNCTION public.${name}(_encounter_id uuid, _claim_token uuid, _candidate_tick integer, _expected_last_tick integer, _expected_state_version bigint, _intent_ids uuid[], _proposed jsonb)`;
  const search=name.endsWith('without_bounded_failure')?"SET search_path TO 'public'":"SET search_path TO 'public', 'pg_temp'";
  if(!text.startsWith(header)||!text.includes('SECURITY DEFINER')||!text.includes(search))throw Error(`Identity mismatch: ${name}`);
  return [name,text];
 }));
}
function once(text,old,replacement){if(text.split(old).length!==2)throw Error('Unexpected exact patch anchor');return text.replace(old,()=>replacement);}
export function replacement(bodies){
 let text=once(bodies.node_tick_commit_without_bounded_failure,'  v_delivered   jsonb;','  v_delivered   jsonb;\n  v_progression_claim uuid;');
 text=once(text,'    INSERT INTO public.node_reward_claim','    v_progression_claim := NULL;\n    INSERT INTO public.node_reward_claim');
 text=once(text,'    ON CONFLICT (creature_id, spawn_seq, character_id) DO NOTHING;','    ON CONFLICT (creature_id, spawn_seq, character_id) DO NOTHING\n    RETURNING id INTO v_progression_claim;');
 text=once(text,"    IF FOUND THEN\n      PERFORM set_config('app.trusted_rpc', 'true', true);\n      UPDATE public.characters\n         SET xp   = xp   + COALESCE((rec->>'xp_awarded')::int, 0),\n             gold = gold + COALESCE((rec->>'gold_awarded')::int, 0)",
 "    IF FOUND THEN\n      PERFORM public.combat2_apply_claim_progression_internal(v_progression_claim,_encounter_id);\n      PERFORM set_config('app.trusted_rpc', 'true', true);\n      UPDATE public.characters\n         SET gold = gold + COALESCE((rec->>'gold_awarded')::int, 0)");
 return text;
}
export const helper=`CREATE FUNCTION public.combat2_apply_claim_progression_internal(_claim uuid,_encounter uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $adapter$
DECLARE reward public.node_reward_claim%ROWTYPE; result jsonb;
BEGIN
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'progression_browser_context_forbidden'; END IF;
 SELECT * INTO reward FROM public.node_reward_claim WHERE id=_claim FOR UPDATE;
 IF NOT FOUND OR reward.encounter_id IS DISTINCT FROM _encounter OR reward.xp_awarded IS NULL OR reward.xp_awarded<0
   THEN RAISE EXCEPTION 'invalid_accepted_reward_claim'; END IF;
 result:=public.progression_apply_xp_internal(reward.character_id,reward.id,'combat2_reward',reward.xp_awarded,
   jsonb_build_object('rewardClaimId',reward.id));
 IF result->>'kind' IS NULL OR result->>'kind' NOT IN ('committed','replayed') THEN
   RAISE EXCEPTION 'combat2_progression_refused' USING ERRCODE='P0001';
 END IF;
 RETURN result;
END $adapter$;
ALTER FUNCTION public.combat2_apply_claim_progression_internal(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.combat2_apply_claim_progression_internal(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
`;
export function payload(){
 const bodies=verifiedBodies();
 const guards=Object.entries(evidence).map(([name,[,hash]])=>` IF encode(sha256(convert_to(pg_get_functiondef('public.${name}(${argumentsSql})'::regprocedure),'UTF8')),'hex')<>'${hash}'
  OR (SELECT proowner<>'postgres'::regrole OR NOT prosecdef FROM pg_proc WHERE oid='public.${name}(${argumentsSql})'::regprocedure)
 THEN RAISE EXCEPTION '001D installed body/security drift: ${name}'; END IF;`).join('\n');
 const aclTargets=["'public.combat2_apply_claim_progression_internal(uuid,uuid)'::regprocedure",...Object.keys(evidence).map(n=>`'public.${n}(${argumentsSql})'::regprocedure`)];
 return `-- ENG-PROGRESSION-001D reviewed local preparation; NOT installed/active.
-- Standard Lovable custom-SQL payload, outside discovery. Atomic tool transaction required.
-- Source b3950cbb; exact read-only function transfer 2026-10-06 12:17:05-12:17:15 UTC.
-- Deploy/verify crafting/admin pauses and deny production tick entry before installation.
-- HOSTED MULTI-SESSION BEHAVIOR: UNPROVEN.
DO $guard$ BEGIN
${guards}
 IF to_regprocedure('public.combat2_apply_claim_progression_internal(uuid,uuid)') IS NOT NULL
 THEN RAISE EXCEPTION '001D adapter name collision'; END IF;
END $guard$;
${readFileSync('docs/operations/progression-001D-containment.sql','utf8')}
${helper}
${replacement(bodies)};
-- Owner-internal composition remains intact; ordinary callers cannot bypass wrappers.
DO $acl$ DECLARE row record; grant_row record;
BEGIN
 FOR row IN SELECT oid,proowner,oid::regprocedure::text identity FROM pg_proc WHERE oid IN (${aclTargets.join(',')}) LOOP
  FOR grant_row IN SELECT DISTINCT grantee FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=row.oid),acldefault('f',row.proowner))) WHERE grantee<>row.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',row.identity,CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END);
  END LOOP;
 END LOOP;
 -- Only the fully validated outer tick RPC retains ordinary service execution.
 GRANT EXECUTE ON FUNCTION public.node_tick_commit(${argumentsSql}) TO service_role;
END $acl$;
`;
}
if(process.argv.includes('--import-evidence')){
 const bodies=verifiedBodies('../001D-hosted-evidence');mkdirSync(evidenceRoot,{recursive:true});
 for(const [name,text] of Object.entries(bodies))writeFileSync(`${evidenceRoot}/${name}.sql`,text,'utf8');
 console.log('Five evidence copies verified/imported without normalization');
}
if(process.argv.includes('--write')){writeFileSync('docs/operations/progression-001D-cutover.sql',payload(),'utf8');console.log('Local payload generated; no SQL executed');}
if(process.argv.includes('--check')){if(readFileSync('docs/operations/progression-001D-cutover.sql','utf8')!==payload())throw Error('Prepared payload not synchronized');console.log('Evidence and deterministic payload verified');}
