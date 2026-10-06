CREATE OR REPLACE FUNCTION public.node_tick_commit_without_authoritative_arrival(_encounter_id uuid, _claim_token uuid, _candidate_tick integer, _expected_last_tick integer, _expected_state_version bigint, _intent_ids uuid[], _proposed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$
