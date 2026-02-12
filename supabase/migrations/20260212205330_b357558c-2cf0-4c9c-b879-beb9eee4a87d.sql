
-- RPC for party leader to update a party member's HP during combat
-- This bypasses the is_following requirement in the characters UPDATE RLS policy
CREATE OR REPLACE FUNCTION public.update_party_member_hp(
  _character_id uuid,
  _new_hp integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the caller is the party leader of a party containing this character
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm
    JOIN parties p ON p.id = pm.party_id
    WHERE pm.character_id = _character_id
    AND pm.status = 'accepted'
    AND owns_character(p.leader_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not the party leader';
  END IF;

  UPDATE characters SET hp = GREATEST(_new_hp, 0) WHERE id = _character_id;
END;
$$;
