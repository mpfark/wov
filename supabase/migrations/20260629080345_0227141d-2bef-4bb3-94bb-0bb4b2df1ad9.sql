
CREATE OR REPLACE FUNCTION public.apply_contract_complete(_character_id uuid, _new_count integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET active_contract = NULL,
         contracts_completed = GREATEST(COALESCE(contracts_completed,0), _new_count)
   WHERE id = _character_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_contract_complete(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_contract_complete(uuid, integer) TO service_role;
