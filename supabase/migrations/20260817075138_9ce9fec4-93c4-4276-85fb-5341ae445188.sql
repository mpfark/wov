CREATE OR REPLACE FUNCTION public.node_creature_roster(_character_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_node uuid;
  v_awake boolean;
  v_pending integer;
  v_creatures jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT c.user_id, c.current_node_id INTO v_owner, v_node
  FROM public.characters c
  WHERE c.id = _character_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'not_owned' USING ERRCODE = '42501';
  END IF;

  IF v_owner <> auth.uid() AND NOT public.is_steward_or_overlord() THEN
    RAISE EXCEPTION 'not_owned' USING ERRCODE = '42501';
  END IF;

  IF v_node IS NULL THEN
    RAISE EXCEPTION 'no_current_node' USING ERRCODE = '22023';
  END IF;

  SELECT (ws.state = 'awake') INTO v_awake FROM public.world_state ws WHERE ws.id = 1;
  v_awake := COALESCE(v_awake, false);

  SELECT count(*)::int INTO v_pending
  FROM public.creatures cr
  WHERE cr.node_id = v_node
    AND cr.is_alive = false
    AND cr.died_at IS NOT NULL
    AND cr.died_at + make_interval(secs => COALESCE(cr.respawn_seconds, 0)) <= now();

  SELECT COALESCE(jsonb_agg(to_jsonb(cr) ORDER BY cr.name, cr.id), '[]'::jsonb)
  INTO v_creatures
  FROM public.creatures cr
  WHERE cr.node_id = v_node
    AND cr.is_alive = true;

  RETURN jsonb_build_object(
    'node_id', v_node,
    'realm_awake', v_awake,
    'respawn_pending', COALESCE(v_pending, 0),
    'creatures', v_creatures
  );
END;
$$;

REVOKE ALL ON FUNCTION public.node_creature_roster(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_creature_roster(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.node_creature_roster(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.node_creature_roster(uuid) TO service_role;