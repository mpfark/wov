
-- Function to check if a character is in the same party as the current user
CREATE OR REPLACE FUNCTION public.is_party_mate(_character_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _character_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
      AND pm2.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
      AND pm1.character_id != pm2.character_id
  )
$$;

-- Function to get a character's name (for pending invite display)
CREATE OR REPLACE FUNCTION public.get_character_name(_character_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name FROM characters WHERE id = _character_id
$$;

-- Restrict characters SELECT to owners, admins, and party mates
DROP POLICY IF EXISTS "Authenticated users can view characters" ON public.characters;
CREATE POLICY "Users can view own or party characters"
  ON public.characters FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR is_maiar_or_valar() OR is_party_mate(id));
