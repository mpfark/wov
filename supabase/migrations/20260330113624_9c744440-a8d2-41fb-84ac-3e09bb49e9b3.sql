
-- Allow pending party members to view the party they've been invited to
CREATE POLICY "Pending members can view party"
ON public.parties
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM party_members
    WHERE party_members.party_id = parties.id
      AND party_members.status = 'pending'
      AND party_members.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  )
);
