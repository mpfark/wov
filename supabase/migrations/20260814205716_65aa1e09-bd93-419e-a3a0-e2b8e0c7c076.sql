CREATE OR REPLACE FUNCTION public.catchup_scope_check(_user_id uuid, _character_id uuid, _node_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current uuid;
  v_scoped uuid;
BEGIN
  SELECT current_node_id INTO v_current
  FROM public.characters
  WHERE id = _character_id AND user_id = _user_id;

  IF v_current IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.characters WHERE id = _character_id AND user_id = _user_id
  ) THEN
    RETURN 'not_owned';
  END IF;

  -- No explicit node: the caller is scoped to the character's own location.
  IF _node_id IS NULL THEN
    IF v_current IS NULL THEN RETURN 'no_node'; END IF;
    RETURN 'ok:' || v_current::text;
  END IF;

  -- 1. The character's own location.
  IF _node_id = v_current THEN RETURN 'ok:' || _node_id::text; END IF;

  -- 2. A location directly connected to the character's location.
  IF v_current IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.nodes n
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.connections, '[]'::jsonb)) AS c
    WHERE n.id = v_current
      AND (c->>'node_id')::uuid = _node_id
  ) THEN
    RETURN 'ok:' || _node_id::text;
  END IF;

  -- 3. A location where this character still sources an unexpired effect
  --    (the departed-node damage-over-time case).
  IF EXISTS (
    SELECT 1 FROM public.active_effects ae
    WHERE ae.node_id = _node_id AND ae.source_id = _character_id
  ) THEN
    RETURN 'ok:' || _node_id::text;
  END IF;

  RETURN 'out_of_scope';
END;
$$;

REVOKE ALL ON FUNCTION public.catchup_scope_check(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.catchup_scope_check(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.catchup_scope_check(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.catchup_scope_check(uuid, uuid, uuid) TO service_role;