CREATE OR REPLACE FUNCTION public.node_tick_commit_without_character_stances(_encounter_id uuid, _claim_token uuid, _candidate_tick integer, _expected_last_tick integer, _expected_state_version bigint, _intent_ids uuid[], _proposed jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE locked_node uuid;
BEGIN
  FOR locked_node IN
    SELECT node_id FROM (
      SELECT e.node_id FROM public.node_encounter e WHERE e.id=_encounter_id
      UNION
      SELECT (departure->>'destination_node_id')::uuid
      FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) departure
      WHERE departure->>'outcome'='moved'
    ) nodes WHERE node_id IS NOT NULL ORDER BY node_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_node::text,0));
  END LOOP;
  RETURN public.node_tick_commit_without_authoritative_arrival(
    _encounter_id,_claim_token,_candidate_tick,_expected_last_tick,
    _expected_state_version,_intent_ids,_proposed);
END;
$function$
