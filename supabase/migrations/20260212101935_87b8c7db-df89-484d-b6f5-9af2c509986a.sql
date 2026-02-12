
-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view own characters" ON public.characters;

-- Recreate scoped to authenticated users only
CREATE POLICY "Users can view own characters"
ON public.characters
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING ((auth.uid() = user_id) OR is_maiar_or_valar());
