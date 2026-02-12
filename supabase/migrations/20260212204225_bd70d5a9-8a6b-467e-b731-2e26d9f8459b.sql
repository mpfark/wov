-- Allow authenticated players to update creature combat fields (hp, is_alive, died_at)
CREATE POLICY "Players can update creature combat state"
ON public.creatures
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Drop the old admin-only update policy and recreate it more specifically for full edits
-- Actually, we need to keep admin policy. The new policy allows all authenticated users to update.
-- Since RLS requires authentication by default, this is safe — only logged-in users can update.
-- The server-side respawn job uses service role which bypasses RLS anyway.

-- Actually let's be more targeted: use a function to handle creature damage
CREATE OR REPLACE FUNCTION public.damage_creature(
  _creature_id uuid,
  _new_hp integer,
  _killed boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _killed THEN
    UPDATE creatures SET hp = 0, is_alive = false, died_at = now() WHERE id = _creature_id;
  ELSE
    UPDATE creatures SET hp = _new_hp WHERE id = _creature_id;
  END IF;
END;
$$;

-- Drop the overly broad policy we just created
DROP POLICY IF EXISTS "Players can update creature combat state" ON public.creatures;