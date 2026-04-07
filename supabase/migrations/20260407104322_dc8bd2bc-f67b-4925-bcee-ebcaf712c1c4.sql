CREATE OR REPLACE FUNCTION public.summon_player(
  _summoner_id uuid,
  _target_name text,
  _summoner_node_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _target RECORD;
BEGIN
  IF NOT owns_character(_summoner_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  SELECT id, current_node_id INTO _target
  FROM characters
  WHERE lower(name) = lower(_target_name);
  
  IF _target IS NULL THEN
    RAISE EXCEPTION 'Player not found';
  END IF;
  
  IF _target.id = _summoner_id THEN
    RAISE EXCEPTION 'Cannot summon yourself';
  END IF;
  
  -- Check target is not in combat
  IF EXISTS (
    SELECT 1 FROM combat_sessions
    WHERE character_id = _target.id
       OR (party_id IN (SELECT party_id FROM party_members WHERE character_id = _target.id AND status = 'accepted'))
  ) THEN
    RAISE EXCEPTION 'Target is in combat';
  END IF;
  
  UPDATE characters
  SET current_node_id = _summoner_node_id
  WHERE id = _target.id;
  
  RETURN _target.current_node_id;
END;
$$;