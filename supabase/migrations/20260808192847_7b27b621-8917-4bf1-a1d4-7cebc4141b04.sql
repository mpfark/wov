CREATE OR REPLACE FUNCTION public.move_follower(_character_id uuid, _node_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok boolean;
  _current_node uuid;
  _adjacent boolean;
  _str integer;
  _capacity integer;
  _bag numeric;
  _cost integer;
BEGIN
  IF _node_id IS NULL OR _character_id IS NULL THEN
    RAISE EXCEPTION 'character_id and node_id are required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nodes WHERE id = _node_id) THEN
    RAISE EXCEPTION 'Node not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.party_members pm
    JOIN public.parties p ON p.id = pm.party_id
    WHERE pm.character_id = _character_id
      AND pm.status = 'accepted'
      AND pm.is_following = true
      AND public.owns_character(p.leader_id)
  ) INTO _ok;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Not authorized: target is not a following member of your party';
  END IF;

  SELECT current_node_id, str INTO _current_node, _str
  FROM public.characters WHERE id = _character_id;

  IF _current_node = _node_id THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.nodes n,
         jsonb_array_elements(COALESCE(n.connections, '[]'::jsonb)) conn
    WHERE n.id = _current_node
      AND (conn->>'node_id')::uuid = _node_id
  ) INTO _adjacent;

  IF NOT _adjacent THEN
    RAISE EXCEPTION 'Destination is not adjacent to follower''s current node';
  END IF;

  -- Movement cost mirrors the leader's formula: capacity = max(12 + str mod, 10),
  -- bag weight counts unequipped items (consumables 1/3), cost = 5 + 3 per unit over.
  _capacity := GREATEST(12 + FLOOR((COALESCE(_str, 10) - 10) / 2.0)::int, 10);

  SELECT COALESCE(SUM(CASE WHEN i.item_type = 'consumable' THEN 1.0/3.0 ELSE 1.0 END), 0)
  INTO _bag
  FROM public.character_inventory ci
  JOIN public.items i ON i.id = ci.item_id
  WHERE ci.character_id = _character_id
    AND ci.equipped_slot IS NULL;

  _cost := 5 + GREATEST(0, CEIL(_bag)::int - _capacity) * 3;

  UPDATE public.characters
  SET current_node_id = _node_id,
      mp = GREATEST(COALESCE(mp, 0) - _cost, 0)
  WHERE id = _character_id;
END;
$$;

REVOKE ALL ON FUNCTION public.move_follower(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_follower(uuid, uuid) TO authenticated;