-- Drop existing INSERT policy
DROP POLICY "Can insert party members" ON public.party_members;

-- Recreate: self-inserts must be 'pending', leaders can set any status
CREATE POLICY "Can insert party members"
ON public.party_members
FOR INSERT
WITH CHECK (
  (owns_character(character_id) AND status = 'pending')
  OR (
    EXISTS (
      SELECT 1 FROM parties
      WHERE id = party_members.party_id
        AND owns_character(parties.leader_id)
    )
  )
);

-- Drop existing UPDATE policy
DROP POLICY "Can update party members" ON public.party_members;

-- Recreate: anyone can update their own row or leader can update party rows,
-- but only the leader can set status to 'accepted'
CREATE POLICY "Can update party members"
ON public.party_members
FOR UPDATE
USING (
  owns_character(character_id)
  OR EXISTS (
    SELECT 1 FROM parties
    WHERE id = party_members.party_id
      AND owns_character(parties.leader_id)
  )
)
WITH CHECK (
  CASE WHEN status = 'accepted'
    THEN EXISTS (
      SELECT 1 FROM parties
      WHERE id = party_members.party_id
        AND owns_character(parties.leader_id)
    )
    ELSE true
  END
);