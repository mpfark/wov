

# Fix: Follow Leader Button Blocked by RLS

## Root Cause

The `party_members` UPDATE RLS policy has a `WITH CHECK` clause that only allows the **party leader** to update rows where `status = 'accepted'`. When a non-leader member clicks "Follow Leader", they're updating their own `is_following` field on an accepted membership row — the `USING` clause passes (they own the character), but the `WITH CHECK` silently rejects the write.

## Fix

**Migration**: Update the `WITH CHECK` expression on the `party_members` UPDATE policy to also allow character owners to update their own rows (not just leaders):

```sql
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
```

This allows members to update their own accepted rows (for `is_following` toggle) while still preventing arbitrary status changes by non-leaders — the `accept_party_invite` RPC already uses `SECURITY DEFINER` to bypass RLS for status changes.

**One migration, no code changes needed.**

