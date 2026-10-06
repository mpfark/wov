CREATE OR REPLACE FUNCTION public.node_tick_commit_without_boss_timing(_encounter_id uuid, _claim_token uuid, _candidate_tick integer, _expected_last_tick integer, _expected_state_version bigint, _intent_ids uuid[], _proposed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE result jsonb; failure_code text;
BEGIN
 result:=public.node_tick_commit_without_bounded_failure(_encounter_id,_claim_token,_candidate_tick,
  _expected_last_tick,_expected_state_version,_intent_ids,_proposed);
 IF jsonb_typeof(result)<>'object' OR result->>'ok' IS NULL OR result->>'kind' IS NULL THEN
  RETURN jsonb_build_object('ok',false,'kind','internal_failure','code','P0001');
 END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS failure_code=RETURNED_SQLSTATE;
 RETURN jsonb_build_object('ok',false,'kind','internal_failure','code',
  CASE WHEN failure_code~'^[[:alnum:]]{5}$' THEN failure_code ELSE 'P0001' END);
END $function$
