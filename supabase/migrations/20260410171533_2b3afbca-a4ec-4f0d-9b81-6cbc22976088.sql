DROP POLICY "Can update party members" ON public.party_members;

CREATE POLICY "Can update party members"
ON public.party_members
FOR UPDATE
TO public
USING (
  owns_character(character_id)
  OR EXISTS (
    SELECT 1 FROM parties
    WHERE parties.id = party_members.party_id
      AND owns_character(parties.leader_id)
  )
)
WITH CHECK (
  CASE
    WHEN status = 'accepted' THEN
      owns_character(character_id)
      OR EXISTS (
        SELECT 1 FROM parties
        WHERE parties.id = party_members.party_id
          AND owns_character(parties.leader_id)
      )
    ELSE true
  END
);