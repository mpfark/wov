
-- 1) BONDS: revoke direct writes; reads stay open. Server uses SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS "Owners write their bonds" ON public.character_class_bonds;
-- (Owners read their bonds + Admins read all bonds policies remain.)

-- 2) SUMMON: tighten target UPDATE policy to status-only, and recompute cp_cost server-side.
DROP POLICY IF EXISTS "Target can update summon requests" ON public.summon_requests;
CREATE POLICY "Target can update summon status"
  ON public.summon_requests
  FOR UPDATE
  USING (owns_character(target_id))
  WITH CHECK (
    owns_character(target_id)
    AND status IN ('pending','accepted','declined')
  );

-- Recompute CP cost inside accept_summon, ignore client-supplied value.
CREATE OR REPLACE FUNCTION public.accept_summon(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _req RECORD;
  _summoner RECORD;
  _from_region RECORD;
  _to_region RECORD;
  _same_region boolean;
  _level_diff int;
  _cp_cost int;
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

  IF EXISTS (
    SELECT 1 FROM combat_sessions
    WHERE character_id = _req.target_id
       OR (party_id IN (SELECT party_id FROM party_members WHERE character_id = _req.target_id AND status = 'accepted'))
  ) THEN
    RAISE EXCEPTION 'Cannot accept summon while in combat';
  END IF;

  -- Server-side CP cost recompute (mirrors calculateTeleportCpCost):
  --   no from-region  -> 15
  --   same region     -> 10
  --   else min(10 + |levelDiff|*2, 30)
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

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters SET cp = cp - _cp_cost WHERE id = _req.summoner_id;
  UPDATE characters SET current_node_id = _req.summoner_node_id WHERE id = _req.target_id;

  DELETE FROM summon_requests WHERE id = _request_id;
END;
$function$;

-- 3) PARTY MEMBERS: stop leader from force-accepting / changing status of other members.
-- Leader retains DELETE (kick) and can update current_node_id; owners manage their own status.
DROP POLICY IF EXISTS "Can update party members" ON public.party_members;
CREATE POLICY "Can update party members"
  ON public.party_members
  FOR UPDATE
  USING (
    owns_character(character_id)
    OR EXISTS (
      SELECT 1 FROM parties
      WHERE parties.id = party_members.party_id
        AND owns_character(parties.leader_id)
    )
  )
  WITH CHECK (
    status IN ('pending','accepted')
    AND (
      -- Owner of the character row may freely update (e.g. accept their own invite).
      owns_character(character_id)
      -- Leader may update fields, but ONLY if they don't change the status of someone else.
      OR (
        EXISTS (
          SELECT 1 FROM parties
          WHERE parties.id = party_members.party_id
            AND owns_character(parties.leader_id)
        )
        AND status = (SELECT pm.status FROM party_members pm WHERE pm.id = party_members.id)
      )
    )
  );
