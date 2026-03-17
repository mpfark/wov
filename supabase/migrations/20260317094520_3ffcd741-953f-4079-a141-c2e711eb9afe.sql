
CREATE OR REPLACE FUNCTION public.is_party_member(_party_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM party_members
    WHERE party_id = _party_id
      AND status = 'accepted'
      AND character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );
$$;
