-- 1) Narrow the characters UPDATE policy: remove the broad party-leader branch.
DROP POLICY IF EXISTS "Users can update own characters" ON public.characters;
CREATE POLICY "Users can update own characters"
ON public.characters
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2) Dedicated RPC for the leader-moves-follower flow.
--    Only updates current_node_id, and only when caller is the party leader
--    and the target is an accepted, following member.
CREATE OR REPLACE FUNCTION public.move_follower(_character_id uuid, _node_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok boolean;
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

  UPDATE public.characters
  SET current_node_id = _node_id
  WHERE id = _character_id;
END;
$$;

REVOKE ALL ON FUNCTION public.move_follower(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.move_follower(uuid, uuid) TO authenticated;

-- 3) Tighten party_members UPDATE WITH CHECK so it never falls back to TRUE.
DROP POLICY IF EXISTS "Can update party members" ON public.party_members;
CREATE POLICY "Can update party members"
ON public.party_members
FOR UPDATE
USING (
  public.owns_character(character_id)
  OR EXISTS (
    SELECT 1 FROM public.parties
    WHERE parties.id = party_members.party_id
      AND public.owns_character(parties.leader_id)
  )
)
WITH CHECK (
  status IN ('pending', 'accepted')
  AND (
    public.owns_character(character_id)
    OR EXISTS (
      SELECT 1 FROM public.parties
      WHERE parties.id = party_members.party_id
        AND public.owns_character(parties.leader_id)
    )
  )
);

-- 4) Stonebinder: atomic, locked existence-check + commit, to prevent
--    two concurrent fuses from creating duplicate world-unique ascended stones.
CREATE OR REPLACE FUNCTION public.stonebinder_commit_fuse(
  p_character_id uuid,
  p_source_inv_a uuid,
  p_source_inv_b uuid,
  p_ascended_item_id uuid,
  p_durability integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_inv_id uuid;
  _exists boolean;
BEGIN
  IF NOT public.owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Serialize on the target ascended item id.
  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || p_ascended_item_id::text));

  -- World-uniqueness re-check inside the lock.
  SELECT
    EXISTS (SELECT 1 FROM public.character_inventory WHERE item_id = p_ascended_item_id)
    OR EXISTS (
      SELECT 1 FROM public.marketplace_listings
      WHERE item_id = p_ascended_item_id AND status = 'active'
    )
    OR EXISTS (SELECT 1 FROM public.node_ground_loot WHERE item_id = p_ascended_item_id)
  INTO _exists;

  IF _exists THEN
    RAISE EXCEPTION 'That ascended stone already exists in the world.'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Consume the two source primaries (only if still present, unequipped, owned by caller).
  WITH deleted AS (
    DELETE FROM public.character_inventory
    WHERE id IN (p_source_inv_a, p_source_inv_b)
      AND character_id = p_character_id
      AND equipped_slot IS NULL
    RETURNING id
  )
  SELECT count(*) INTO _exists FROM deleted;

  IF _exists::int <> 2 THEN
    RAISE EXCEPTION 'Source stones not available (already used or equipped).';
  END IF;

  INSERT INTO public.character_inventory (character_id, item_id, equipped_slot, current_durability)
  VALUES (p_character_id, p_ascended_item_id, NULL, COALESCE(p_durability, 100))
  RETURNING id INTO _new_inv_id;

  RETURN _new_inv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stonebinder_commit_fuse(uuid, uuid, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stonebinder_commit_fuse(uuid, uuid, uuid, uuid, integer) TO service_role;