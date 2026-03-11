CREATE OR REPLACE FUNCTION public.admin_teleport(_character_id uuid, _node_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_steward_or_overlord() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM nodes WHERE id = _node_id) THEN
    RAISE EXCEPTION 'Node not found';
  END IF;
  UPDATE characters SET current_node_id = _node_id WHERE id = _character_id;
END;
$$;