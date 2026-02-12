
-- Allow all authenticated users to view all characters (game stats are not sensitive)
DROP POLICY IF EXISTS "Users can view own characters" ON public.characters;
CREATE POLICY "Authenticated users can view characters"
  ON public.characters FOR SELECT
  TO authenticated
  USING (true);
