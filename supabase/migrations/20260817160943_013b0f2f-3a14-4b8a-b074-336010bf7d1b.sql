CREATE OR REPLACE FUNCTION public.effects_scope_revalidate(_encounter_id uuid, _node_id uuid, _due_at_ms bigint DEFAULT NULL::bigint)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_mode text;
  v_due int := 0;
  v_granted boolean := false;
BEGIN
  IF _encounter_id IS NULL OR _node_id IS NULL THEN
    RETURN 'invalid_scope';
  END IF;

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN RETURN 'no_encounter'; END IF;
  IF v_enc.node_id IS DISTINCT FROM _node_id THEN RETURN 'node_mismatch'; END IF;
  IF v_enc.status NOT IN ('active','idle') THEN RETURN 'no_encounter'; END IF;

  IF NOT public.world_is_awake() THEN RETURN 'world_asleep'; END IF;

  SELECT COALESCE(value, 'open') INTO v_mode FROM public.combat_config WHERE key = 'combat_mode';
  IF COALESCE(v_mode, 'open') <> 'open' THEN
    v_granted := public.effects_scope_grant_check(_encounter_id, _node_id);
    IF NOT v_granted THEN
      RETURN 'scope_not_granted';
    END IF;
  END IF;

  SELECT due_count INTO v_due
  FROM public.effects_due_scopes(50, NULL)
  WHERE encounter_id = _encounter_id;

  IF COALESCE(v_due, 0) = 0 THEN RETURN 'nothing_due'; END IF;

  RETURN CASE WHEN v_granted THEN 'ok:granted' ELSE 'ok' END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.effects_scope_revalidate(uuid, uuid, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effects_scope_revalidate(uuid, uuid, bigint) TO service_role;