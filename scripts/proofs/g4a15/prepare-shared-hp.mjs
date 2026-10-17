// Local source assembly only. No connections, SQL execution or migration runner.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8').replace(/\r\n/g,'\n');
const base=read('docs/operations/legacy-001G4A19-admin-candidate.sql');
assert.equal(createHash('sha256').update(base).digest('hex'),'adb27d6dcb0b2334f53fc07a6d71e95fc6ca778e931681e80c2cc9ac7321ec8a');
export function buildSharedHP(){
 let sql=base.replace('-- LOCAL CANDIDATE ONLY.', '-- G4A20 FORWARD CANDIDATE ONLY. Full caller wiring remains gated.');
 sql=sql.replace("-- Shared HP transition callers/legacy healer cutover are NOT installed by this file.","-- PARTIAL / NOT INSTALLABLE: caller hook promotion is incomplete.\n-- Replaces legacy healer leaves, but not their complete public caller composition.");
 sql=sql.replace("IF desired.boss_cast IS DISTINCT FROM c.boss_cast THEN answer:='unsupported_boss'; END IF;",
   "IF desired.boss_cast IS DISTINCT FROM c.boss_cast AND NOT public.creature_admin_boss_valid(desired.boss_cast) THEN answer:='unsupported_boss'; END IF;");
 sql=sql.replace("ELSIF _action IN('delete','move') AND public.creature_admin_referenced(_creature_id)",
   "ELSIF (_action='delete' OR (_action='move' AND dest IS NULL)) AND public.creature_admin_referenced(_creature_id)");
 sql=sql.replace("ELSIF EXISTS(SELECT 1 FROM public.node_creature WHERE creature_id=_creature_id) THEN",
   "ELSIF EXISTS(SELECT 1 FROM public.node_creature WHERE creature_id=_creature_id AND spawn_seq<>c.spawn_seq) THEN");
 sql=sql.replace("IF dest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=dest) THEN answer:='invalid_request'; END IF;",
 `IF dest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.nodes WHERE id=dest) THEN answer:='invalid_request'; END IF;
       IF _action='move' AND dest IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.node_encounter WHERE node_id=dest AND status='ended')
         OR EXISTS(SELECT 1 FROM public.node_encounter e WHERE e.node_id=dest AND (
           EXISTS(SELECT 1 FROM public.node_effect x WHERE x.encounter_id=e.id)
           OR EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.encounter_id=e.id AND nc.pending_action IS NOT NULL)
           OR EXISTS(SELECT 1 FROM public.node_intent i WHERE i.encounter_id=e.id AND i.status='pending')
           OR EXISTS(SELECT 1 FROM public.node_pending_event p WHERE p.encounter_id=e.id AND p.consumed_at IS NULL))))
       THEN answer:='integration_required'; END IF;`);
 sql=sql.replace("UPDATE public.creatures SET node_id=dest WHERE id=_creature_id;",`UPDATE public.node_creature SET encounter_id=(SELECT id FROM public.node_encounter WHERE node_id=dest),
             engaged=false,tank_fighter_id=NULL WHERE creature_id=_creature_id AND spawn_seq=c.spawn_seq;
           UPDATE public.creatures SET node_id=dest WHERE id=_creature_id;
           UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
             WHERE node_id=c.node_id OR node_id=dest;`);
 sql=sql.replace("         answer:='updated';\n       END IF;",`         UPDATE public.node_creature SET hp=new_hp,is_alive=c.is_alive WHERE creature_id=_creature_id AND spawn_seq=c.spawn_seq;
         IF _action='save' THEN
           UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
             WHERE id IN(SELECT encounter_id FROM public.node_creature WHERE creature_id=_creature_id AND spawn_seq=c.spawn_seq);
         END IF;
         answer:='updated';
       END IF;`);
 const boss=`
-- Acceptance contract from src/shared/combat2/boss-catalog.ts: adaptBossCast.
-- Disabled/null configurations remain valid non-casts. Only changed docs validate.
CREATE FUNCTION public.creature_admin_boss_valid(cast_doc jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF cast_doc IS NULL OR cast_doc='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(cast_doc)<>'object' THEN RETURN false; END IF;
 IF cast_doc?'enabled' AND jsonb_typeof(cast_doc->'enabled')<>'boolean' THEN RETURN false; END IF;
 IF cast_doc->'enabled'='false'::jsonb THEN RETURN true; END IF;
 IF (cast_doc?'label' AND cast_doc->'label'<>'null'::jsonb AND jsonb_typeof(cast_doc->'label')<>'string')
 OR (cast_doc?'ability_key' AND cast_doc->'ability_key'<>'null'::jsonb AND jsonb_typeof(cast_doc->'ability_key')<>'string') THEN RETURN false; END IF;
 IF coalesce(nullif(btrim(cast_doc->>'ability_key'),''),nullif(btrim(cast_doc->>'label'),'')) IS NULL THEN RETURN false; END IF;
 IF jsonb_typeof(cast_doc->'cast_ms') IS DISTINCT FROM 'number' OR (cast_doc->>'cast_ms')::numeric<=0 THEN RETURN false; END IF;
 IF ((jsonb_typeof(cast_doc->'base_amount')='number' AND (cast_doc->>'base_amount')::numeric>0)
   OR (coalesce(jsonb_typeof(cast_doc->'base_amount'),'null')<>'number' AND jsonb_typeof(cast_doc->'amount')='number' AND (cast_doc->>'amount')::numeric>0)) IS DISTINCT FROM true THEN RETURN false; END IF;
 IF cast_doc->'target_mode' IS NOT NULL AND cast_doc->'target_mode'<>'null'::jsonb
   AND cast_doc->>'target_mode' NOT IN('tank','aoe','random','tank_preferred','tank_strict','random_alive') THEN RETURN false; END IF;
 RETURN true;
END $$;
ALTER FUNCTION public.creature_admin_boss_valid(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_admin_boss_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
`;
 sql=sql.replace('CREATE FUNCTION public.admin_creature_mutate',()=>boss+'\nCREATE FUNCTION public.admin_creature_mutate');
 const maintenance=`
-- Passive world maintenance: discover/lock all affected nodes before any rows.
CREATE FUNCTION public.creature_hp_maintain() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE discovered jsonb; current_coverage jsonb; n uuid; cid uuid;
BEGIN
 SELECT jsonb_build_object('creatures',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.id,c.node_id,c.spawn_seq) ORDER BY c.id),'[]') FROM public.creatures c),'encounters',(SELECT coalesce(jsonb_agg(jsonb_build_array(e.id,e.node_id) ORDER BY e.id),'[]') FROM public.node_encounter e),'projections',(SELECT coalesce(jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id),'[]') FROM public.node_creature nc)) INTO discovered;
 FOR n IN SELECT DISTINCT v FROM (SELECT (c->>1)::uuid v FROM jsonb_array_elements(discovered->'creatures') c UNION SELECT (e->>1)::uuid FROM jsonb_array_elements(discovered->'encounters') e) s WHERE v IS NOT NULL ORDER BY v LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 PERFORM 1 FROM public.node_encounter WHERE id IN(SELECT (e->>0)::uuid FROM jsonb_array_elements(discovered->'encounters') e) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.node_creature WHERE id IN(SELECT (e->>0)::uuid FROM jsonb_array_elements(discovered->'projections') e) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.creatures WHERE id IN(SELECT (e->>0)::uuid FROM jsonb_array_elements(discovered->'creatures') e) ORDER BY id FOR UPDATE;
 SELECT jsonb_build_object('creatures',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.id,c.node_id,c.spawn_seq) ORDER BY c.id),'[]') FROM public.creatures c),'encounters',(SELECT coalesce(jsonb_agg(jsonb_build_array(e.id,e.node_id) ORDER BY e.id),'[]') FROM public.node_encounter e),'projections',(SELECT coalesce(jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id),'[]') FROM public.node_creature nc)) INTO current_coverage;
 IF discovered IS DISTINCT FROM current_coverage THEN RAISE EXCEPTION 'maintenance coverage changed' USING ERRCODE='40001'; END IF;
 FOR cid IN SELECT id FROM public.creatures ORDER BY id LOOP
   PERFORM public.creature_regen_settle(cid,now());
 END LOOP;
END $$;
ALTER FUNCTION public.creature_hp_maintain() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_hp_maintain() FROM PUBLIC,anon,authenticated,service_role;
-- Existing owner/ACLs must be verified before installation. CREATE OR REPLACE
-- preserves existing ownership/grants; no new browser or service grant is added.
CREATE OR REPLACE FUNCTION public.regen_creature_hp() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM public.creature_hp_maintain(); END $$;
CREATE OR REPLACE FUNCTION public.heal_creatures_on_wake() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- No instant heal and no late node locks inside wake's character-trigger DDL.
 -- Eligible sleep time settles on the next ordinary maintenance or entry.
 RETURN 0;
END $$;
`;
 return sql.replace('COMMIT;',()=>maintenance+'\nCOMMIT;');
}
if(process.argv.includes('--write'))fs.writeFileSync(new URL('docs/operations/legacy-001G4A20-shared-hp-candidate.sql',root),buildSharedHP());
