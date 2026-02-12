
-- 1. Tighten parties SELECT: only members can see their party
DROP POLICY "Anyone can view parties" ON public.parties;
CREATE POLICY "Members can view own party"
ON public.parties
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.party_members pm
    WHERE pm.party_id = parties.id
    AND owns_character(pm.character_id)
  )
);

-- 2. Tighten party_members SELECT: see own rows + members of parties you belong to
DROP POLICY "Anyone can view party members" ON public.party_members;
CREATE POLICY "Members can view party members"
ON public.party_members
FOR SELECT
TO authenticated
USING (
  owns_character(character_id)
  OR EXISTS (
    SELECT 1 FROM public.party_members pm2
    WHERE pm2.party_id = party_members.party_id
    AND owns_character(pm2.character_id)
  )
);

-- 3. Revoke RPC execute from public roles so players can't manipulate game state
REVOKE EXECUTE ON FUNCTION public.respawn_creatures() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.regen_creature_hp() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.return_unique_items() FROM anon, authenticated;

-- 4. Add CHECK constraints for data integrity
ALTER TABLE public.creatures ADD CONSTRAINT creatures_level_range CHECK (level BETWEEN 1 AND 100);
ALTER TABLE public.creatures ADD CONSTRAINT creatures_hp_non_negative CHECK (hp >= 0);
ALTER TABLE public.creatures ADD CONSTRAINT creatures_max_hp_positive CHECK (max_hp >= 1);
ALTER TABLE public.creatures ADD CONSTRAINT creatures_ac_range CHECK (ac BETWEEN 0 AND 50);
ALTER TABLE public.creatures ADD CONSTRAINT creatures_respawn_positive CHECK (respawn_seconds >= 0);

ALTER TABLE public.items ADD CONSTRAINT items_name_length CHECK (length(name) <= 200);
ALTER TABLE public.items ADD CONSTRAINT items_value_non_negative CHECK (value >= 0);
ALTER TABLE public.items ADD CONSTRAINT items_max_durability_positive CHECK (max_durability >= 1);

ALTER TABLE public.characters ADD CONSTRAINT characters_hp_range CHECK (hp >= 0);
ALTER TABLE public.characters ADD CONSTRAINT characters_max_hp_positive CHECK (max_hp >= 1);
ALTER TABLE public.characters ADD CONSTRAINT characters_gold_non_negative CHECK (gold >= 0);
ALTER TABLE public.characters ADD CONSTRAINT characters_level_range CHECK (level BETWEEN 1 AND 100);
ALTER TABLE public.characters ADD CONSTRAINT characters_stats_range CHECK (
  str BETWEEN 1 AND 30 AND dex BETWEEN 1 AND 30 AND con BETWEEN 1 AND 30
  AND int BETWEEN 1 AND 30 AND wis BETWEEN 1 AND 30 AND cha BETWEEN 1 AND 30
);
ALTER TABLE public.characters ADD CONSTRAINT characters_ac_range CHECK (ac BETWEEN 0 AND 50);

ALTER TABLE public.regions ADD CONSTRAINT regions_name_length CHECK (length(name) <= 200);
ALTER TABLE public.regions ADD CONSTRAINT regions_level_range CHECK (min_level >= 1 AND max_level >= min_level);

ALTER TABLE public.nodes ADD CONSTRAINT nodes_name_length CHECK (length(name) <= 200);
