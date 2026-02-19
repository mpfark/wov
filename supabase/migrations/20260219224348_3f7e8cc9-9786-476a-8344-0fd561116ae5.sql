
-- Add character_name column to party_combat_log so we can attribute messages
ALTER TABLE public.party_combat_log ADD COLUMN character_name text;
