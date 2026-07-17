-- One-time purge of orphaned combat_sessions (node no longer matches character)
DELETE FROM public.combat_sessions cs
WHERE cs.character_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.characters c
    WHERE c.id = cs.character_id
      AND c.current_node_id = cs.node_id
  );

DELETE FROM public.combat_sessions cs
WHERE cs.party_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.party_members pm
    JOIN public.characters c ON c.id = pm.character_id
    WHERE pm.party_id = cs.party_id
      AND pm.status = 'accepted'
      AND c.current_node_id = cs.node_id
  );

-- accept_summon: self-heal stale sessions and only block if session is at current node
CREATE OR REPLACE FUNCTION public.accept_summon(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _req RECORD;
  _summoner RECORD;
  _from_region RECORD;
  _to_region RECORD;
  _same_region boolean;
  _level_diff int;
  _cp_cost int;
  _target_node uuid;
BEGIN
  SELECT * INTO _req FROM summon_requests WHERE id = _request_id AND status = 'pending';
  IF _req IS NULL THEN
    RAISE EXCEPTION 'Summon request not found or already handled';
  END IF;

  IF NOT owns_character(_req.target_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _req.expires_at < now() THEN
    DELETE FROM summon_requests WHERE id = _request_id;
    RAISE EXCEPTION 'Summon request has expired';
  END IF;

  SELECT current_node_id INTO _target_node FROM characters WHERE id = _req.target_id;

  -- Self-heal: purge any session for this character whose node no longer
  -- matches — that's dead weight from a prior fight.
  DELETE FROM combat_sessions cs
  WHERE cs.node_id <> _target_node
    AND (
      cs.character_id = _req.target_id
      OR cs.party_id IN (
        SELECT party_id FROM party_members
        WHERE character_id = _req.target_id AND status = 'accepted'
      )
    );

  -- Only block if a live session remains at the character's current node.
  IF EXISTS (
    SELECT 1 FROM combat_sessions cs
    WHERE cs.node_id = _target_node
      AND (
        cs.character_id = _req.target_id
        OR cs.party_id IN (
          SELECT party_id FROM party_members
          WHERE character_id = _req.target_id AND status = 'accepted'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Cannot accept summon while in combat';
  END IF;

  SELECT r.* INTO _to_region
    FROM nodes n JOIN regions r ON r.id = n.region_id
    WHERE n.id = _req.summoner_node_id;

  SELECT r.* INTO _from_region
    FROM characters c
    JOIN nodes n ON n.id = c.current_node_id
    JOIN regions r ON r.id = n.region_id
    WHERE c.id = _req.target_id;

  IF _to_region IS NULL THEN
    RAISE EXCEPTION 'Invalid summon destination';
  END IF;

  IF _from_region IS NULL THEN
    _cp_cost := 15;
  ELSE
    _same_region := (_from_region.id = _to_region.id);
    IF _same_region THEN
      _cp_cost := 10;
    ELSE
      _level_diff := ABS(_to_region.min_level - _from_region.min_level);
      _cp_cost := LEAST(10 + _level_diff * 2, 30);
    END IF;
  END IF;

  SELECT cp INTO _summoner FROM characters WHERE id = _req.summoner_id;
  IF _summoner.cp < _cp_cost THEN
    DELETE FROM summon_requests WHERE id = _request_id;
    RAISE EXCEPTION 'Summoner no longer has enough CP';
  END IF;

  UPDATE characters SET cp = cp - _cp_cost WHERE id = _req.summoner_id;
  UPDATE characters SET current_node_id = _req.summoner_node_id WHERE id = _req.target_id;
  UPDATE summon_requests SET status = 'accepted' WHERE id = _request_id;
END;
$function$;