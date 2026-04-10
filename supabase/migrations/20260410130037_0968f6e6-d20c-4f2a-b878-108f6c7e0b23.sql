
CREATE OR REPLACE FUNCTION public.accept_party_invite(_membership_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _member RECORD;
BEGIN
  SELECT * INTO _member FROM party_members WHERE id = _membership_id AND status = 'pending';
  IF _member IS NULL THEN
    RAISE EXCEPTION 'Invite not found or already handled';
  END IF;

  IF NOT owns_character(_member.character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- If the character is already in another party, remove them first
  DELETE FROM party_members
  WHERE character_id = _member.character_id
    AND status = 'accepted';

  UPDATE party_members SET status = 'accepted' WHERE id = _membership_id;
END;
$$;
