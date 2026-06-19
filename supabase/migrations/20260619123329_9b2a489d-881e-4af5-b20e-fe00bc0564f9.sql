-- Harden grant_searched_item: validate the item is actually in the node's
-- searchable_items pool. Prevents a client from passing an arbitrary item UUID.
CREATE OR REPLACE FUNCTION public.grant_searched_item(p_character_id uuid, p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _node_id uuid;
  _in_pool boolean;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM items WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  SELECT current_node_id INTO _node_id FROM characters WHERE id = p_character_id;
  IF _node_id IS NULL THEN
    RAISE EXCEPTION 'Character has no current node';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM nodes n,
         jsonb_array_elements(COALESCE(n.searchable_items, '[]'::jsonb)) entry
    WHERE n.id = _node_id
      AND (entry->>'item_id')::uuid = p_item_id
  ) INTO _in_pool;

  IF NOT _in_pool THEN
    RAISE EXCEPTION 'Item not available at this node';
  END IF;

  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, p_item_id, 100);

  RETURN true;
END;
$$;

-- Harden move_follower: ensure the destination node is adjacent to the
-- follower's current node (matches the leader's single-step movement rule).
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

  SELECT current_node_id INTO _current_node FROM public.characters WHERE id = _character_id;

  -- Allow no-op (already there) or single-step adjacency via the node's connections graph.
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

  UPDATE public.characters
  SET current_node_id = _node_id
  WHERE id = _character_id;
END;
$$;