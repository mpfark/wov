-- Authoritative tick-based boss cooldowns and dynamic-resolution cast projection.
BEGIN;

CREATE TABLE public.node_boss_ability_cooldown(
 encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
 node_creature_id uuid NOT NULL REFERENCES public.node_creature(id) ON DELETE CASCADE,
 creature_id uuid NOT NULL,
 spawn_seq bigint NOT NULL,
 ability_key text NOT NULL,
 next_available_tick bigint NOT NULL CHECK(next_available_tick>=0),
 PRIMARY KEY(encounter_id,node_creature_id,spawn_seq,ability_key)
);
ALTER TABLE public.node_boss_ability_cooldown ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.node_boss_ability_cooldown FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.node_boss_ability_cooldown TO service_role;

-- The only reviewed hybrid cast: preserve its committed secondary magnitude.
UPDATE public.creatures SET boss_cast=jsonb_set(jsonb_set(boss_cast,'{base_aoe_amount}','10'::jsonb,true),'{target_mode}','"tank"'::jsonb,true)
WHERE id='3d082fe3-c01b-429f-94b9-fad8d3bb3c8d'::uuid
  AND boss_cast->>'ability_key'='the_drowning_toll__3d082fe3'
  AND coalesce((boss_cast->>'base_amount')::numeric,0)=24;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.creatures WHERE id='3d082fe3-c01b-429f-94b9-fad8d3bb3c8d'::uuid
  AND boss_cast->>'ability_key'='the_drowning_toll__3d082fe3'
  AND (boss_cast->>'base_amount')::numeric=24 AND (boss_cast->>'base_aoe_amount')::numeric=10)
 THEN RAISE EXCEPTION 'Drowning Toll normalization prerequisite missing or ambiguous'; END IF;
END $$;

ALTER FUNCTION public.node_tick_claim(uuid,integer) RENAME TO node_tick_claim_without_boss_timing;
REVOKE ALL ON FUNCTION public.node_tick_claim_without_boss_timing(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim_without_boss_timing(uuid,integer) TO service_role;
CREATE FUNCTION public.node_tick_claim(_node_id uuid,_lease_ms integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source jsonb; creatures jsonb;
BEGIN
 source:=public.node_tick_claim_without_boss_timing(_node_id,_lease_ms);
 IF source->>'kind'<>'claimed' THEN RETURN source; END IF;
 SELECT coalesce(jsonb_agg(x.elem||jsonb_build_object('pending_action',CASE WHEN nc.pending_action IS NULL THEN NULL ELSE
  jsonb_build_object('ability_key',nc.pending_action->>'ability_key','ability_label',nc.pending_action->>'ability_label',
   'started_at_tick',(nc.pending_action->>'started_at_tick')::bigint,'resolve_at_tick',(nc.pending_action->>'resolve_at_tick')::bigint,
   'target_mode',nc.pending_action->>'target_mode','primary_magnitude',(nc.pending_action->>'primary_magnitude')::numeric,
   'secondary_magnitude',(nc.pending_action->>'secondary_magnitude')::numeric,'damage_type',nc.pending_action->'damage_type',
   'target_fighter_id',NULL,'target_character_id',NULL,'target_entry_seq',NULL) END) ORDER BY x.ord),'[]'::jsonb)
 INTO creatures FROM jsonb_array_elements(source#>'{snapshot,creatures}') WITH ORDINALITY x(elem,ord)
 JOIN public.node_creature nc ON nc.id=(x.elem->>'id')::uuid;
 source:=jsonb_set(source,'{snapshot,creatures}',creatures);
 source:=jsonb_set(source,'{snapshot,boss_cooldowns}',coalesce((SELECT jsonb_agg(to_jsonb(cd) ORDER BY cd.node_creature_id,cd.spawn_seq,cd.ability_key)
  FROM public.node_boss_ability_cooldown cd WHERE cd.encounter_id=(source->>'encounter_id')::uuid),'[]'::jsonb));
 RETURN source;
END $$;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid,integer) TO service_role;

ALTER FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) RENAME TO node_tick_commit_without_boss_timing;
REVOKE ALL ON FUNCTION public.node_tick_commit_without_boss_timing(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit_without_boss_timing(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;
CREATE FUNCTION public.node_tick_commit(_encounter_id uuid,_claim_token uuid,_candidate_tick integer,_expected_last_tick integer,
 _expected_state_version bigint,_intent_ids uuid[],_proposed jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; rows jsonb:=coalesce(_proposed->'boss_cooldowns','[]'::jsonb); bad integer;
BEGIN
 IF jsonb_typeof(rows)<>'array' THEN RETURN jsonb_build_object('ok',false,'kind','stale_boss_cooldown'); END IF;
 SELECT count(*) INTO bad FROM jsonb_array_elements(rows) r WHERE
  r->>'encounter_id'<>_encounter_id::text OR (r->>'next_available_tick')::bigint<_candidate_tick
  OR NOT EXISTS(SELECT 1 FROM public.node_creature nc WHERE nc.id=(r->>'node_creature_id')::uuid
    AND nc.encounter_id=_encounter_id AND nc.creature_id=(r->>'creature_id')::uuid AND nc.spawn_seq=(r->>'spawn_seq')::bigint)
  OR coalesce((SELECT cd.next_available_tick FROM public.node_boss_ability_cooldown cd
    WHERE cd.encounter_id=_encounter_id AND cd.node_creature_id=(r->>'node_creature_id')::uuid
      AND cd.spawn_seq=(r->>'spawn_seq')::bigint AND cd.ability_key=r->>'ability_key'),0)
    <>coalesce((r->>'expected_next_available_tick')::bigint,0);
 IF bad<>0 THEN RETURN jsonb_build_object('ok',false,'kind','stale_boss_cooldown'); END IF;
 result:=public.node_tick_commit_without_boss_timing(_encounter_id,_claim_token,_candidate_tick,_expected_last_tick,
  _expected_state_version,_intent_ids,_proposed);
 IF result->>'ok'='true' AND result->>'kind'='committed' THEN
  INSERT INTO public.node_boss_ability_cooldown(encounter_id,node_creature_id,creature_id,spawn_seq,ability_key,next_available_tick)
  SELECT (r->>'encounter_id')::uuid,(r->>'node_creature_id')::uuid,(r->>'creature_id')::uuid,(r->>'spawn_seq')::bigint,
    r->>'ability_key',(r->>'next_available_tick')::bigint FROM jsonb_array_elements(rows) r
  ON CONFLICT(encounter_id,node_creature_id,spawn_seq,ability_key) DO UPDATE SET
    creature_id=EXCLUDED.creature_id,next_available_tick=EXCLUDED.next_available_tick;
 END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','internal_failure','code','P0001');
END $$;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb) TO service_role;

ALTER FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) RENAME TO combat2_sync_without_dynamic_boss_casts;
REVOKE ALL ON FUNCTION public.combat2_sync_without_dynamic_boss_casts(uuid,uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_sync_without_dynamic_boss_casts(uuid,uuid,bigint,integer) TO service_role;
CREATE FUNCTION public.combat2_sync(_character_id uuid,_encounter_id uuid,_after_tick bigint DEFAULT 0,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; creatures jsonb;
BEGIN
 result:=public.combat2_sync_without_dynamic_boss_casts(_character_id,_encounter_id,_after_tick,_limit);
 IF result->>'ok'<>'true' THEN RETURN result; END IF;
 SELECT coalesce(jsonb_agg(x.elem||jsonb_build_object('pendingAction',CASE WHEN nc.pending_action IS NULL THEN NULL ELSE
  jsonb_build_object('abilityKey',nc.pending_action->>'ability_key','abilityLabel',nc.pending_action->>'ability_label',
   'startedAtTick',(nc.pending_action->>'started_at_tick')::bigint,'resolveAtTick',(nc.pending_action->>'resolve_at_tick')::bigint,
   'targetMode',nc.pending_action->>'target_mode','targetFighterId',NULL,'targetCharacterId',NULL,'targetEntrySeq',NULL) END) ORDER BY x.ord),'[]'::jsonb)
 INTO creatures FROM jsonb_array_elements(result->'creatures') WITH ORDINALITY x(elem,ord)
 JOIN public.node_creature nc ON nc.id=(x.elem->>'id')::uuid AND nc.encounter_id=_encounter_id;
 RETURN jsonb_set(result,'{creatures}',creatures);
END $$;
REVOKE ALL ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) TO authenticated,service_role;

COMMIT;
