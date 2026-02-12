
DROP POLICY "Users can view own characters" ON public.characters;
CREATE POLICY "Users can view own characters"
ON public.characters
FOR SELECT
TO authenticated
USING ((auth.uid() = user_id) OR is_maiar_or_valar());
