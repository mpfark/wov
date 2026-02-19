
-- Add node_id to party_combat_log so we can filter by location
ALTER TABLE public.party_combat_log
ADD COLUMN node_id uuid REFERENCES public.nodes(id) DEFAULT NULL;
