CREATE OR REPLACE FUNCTION public.node_tick_commit(_encounter_id uuid, _claim_token uuid, _candidate_tick integer, _expected_last_tick integer, _expected_state_version bigint, _intent_ids uuid[], _proposed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE row jsonb; result jsonb; current_version bigint;
BEGIN
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->'stance_fence','[]'::jsonb)) LOOP
   SELECT version INTO current_version FROM public.character_stance
    WHERE character_id=(row->>'character_id')::uuid AND ability_key=row->>'ability_key' FOR UPDATE;
   IF current_version IS DISTINCT FROM (row->>'version')::bigint THEN RETURN jsonb_build_object('ok',false,'kind','stale_stance'); END IF;
 END LOOP;
 result:=public.node_tick_commit_without_character_stances(_encounter_id,_claim_token,_candidate_tick,_expected_last_tick,
   _expected_state_version,_intent_ids,_proposed);
 IF result->>'ok'='true' AND result->>'kind'='committed' THEN
   FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->'stance_updates','[]'::jsonb)) LOOP
     UPDATE public.character_stance SET state=row->'state',version=version+1,updated_at=clock_timestamp()
      WHERE character_id=(row->>'character_id')::uuid AND ability_key=row->>'ability_key' AND version=(row->>'version')::bigint;
     IF NOT FOUND THEN RAISE EXCEPTION 'stale stance update'; END IF;
   END LOOP;
   DELETE FROM public.character_stance WHERE character_id IN
    (SELECT value::text::uuid FROM jsonb_array_elements_text(coalesce(_proposed->'stance_clear_character_ids','[]'::jsonb)));
   UPDATE public.character_stance_request SET committed_at=clock_timestamp()
    WHERE encounter_id=_encounter_id AND intent_id=ANY(_intent_ids) AND committed_at IS NULL;
 END IF;
 RETURN result;
END $function$
