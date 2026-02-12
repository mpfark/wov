
-- Create a security definer function to check party membership without triggering RLS
CREATE OR REPLACE FUNCTION public.is_party_member(_party_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM party_members
    WHERE party_id = _party_id
      AND character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  );
$$;

-- Drop and recreate parties SELECT policy to use the helper
DROP POLICY IF EXISTS "Members can view own party" ON public.parties;
CREATE POLICY "Members can view own party"
  ON public.parties FOR SELECT
  USING (owns_character(leader_id) OR is_party_member(id));

-- Drop and recreate party_members SELECT policy to avoid self-reference
DROP POLICY IF EXISTS "Members can view party members" ON public.party_members;
CREATE POLICY "Members can view party members"
  ON public.party_members FOR SELECT
  USING (owns_character(character_id) OR is_party_member(party_id));
