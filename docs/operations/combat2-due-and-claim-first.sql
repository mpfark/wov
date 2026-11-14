-- ENG-PERF: merged discovery + first claim (prepared, NOT installed).
-- Adds one function; changes no existing function, table, grant or rule.
-- Install through the Lovable custom-SQL migration tool (no top-level BEGIN/COMMIT).
CREATE OR REPLACE FUNCTION public.combat2_due_nodes_claim_first(_limit integer DEFAULT 10, _lease_ms integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE discovery jsonb; first_node uuid; first_claim jsonb;
BEGIN
  discovery := public.combat2_due_nodes(_limit);
  IF discovery->>'ok' IS DISTINCT FROM 'true' OR coalesce(jsonb_array_length(discovery->'candidates'),0)=0 THEN
    RETURN discovery;
  END IF;
  first_node := (discovery#>>'{candidates,0,node_id}')::uuid;
  BEGIN
    first_claim := public.node_tick_claim(first_node, _lease_ms);
  EXCEPTION WHEN OTHERS THEN
    -- Discovery result stays valid; the worker falls back to its normal separate claim.
    first_claim := NULL;
  END;
  IF first_claim IS NULL THEN RETURN discovery; END IF;
  RETURN discovery || jsonb_build_object('first_claim', jsonb_build_object('node_id', first_node, 'claim', first_claim));
END
$function$;

REVOKE ALL ON FUNCTION public.combat2_due_nodes_claim_first(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_due_nodes_claim_first(integer, integer) TO service_role;
