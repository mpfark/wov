
-- Create roadmap_items table
CREATE TABLE public.roadmap_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  is_done BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.roadmap_items ENABLE ROW LEVEL SECURITY;

-- SELECT for all authenticated users
CREATE POLICY "Authenticated users can view roadmap"
ON public.roadmap_items FOR SELECT
TO authenticated
USING (true);

-- INSERT/UPDATE/DELETE for admins only
CREATE POLICY "Admins can insert roadmap items"
ON public.roadmap_items FOR INSERT
TO authenticated
WITH CHECK (is_maiar_or_valar());

CREATE POLICY "Admins can update roadmap items"
ON public.roadmap_items FOR UPDATE
TO authenticated
USING (is_maiar_or_valar());

CREATE POLICY "Admins can delete roadmap items"
ON public.roadmap_items FOR DELETE
TO authenticated
USING (is_maiar_or_valar());

-- Seed the 10 brainstormed ideas
INSERT INTO public.roadmap_items (title, description, category, sort_order) VALUES
('Auto-progressing combat system', 'Combat initiated on attack button, progresses until player or creature dies. Resumes on re-entering node. Aggressive creatures auto-start combat. Attack speed based on DEX.', 'Combat', 1),
('Class abilities (Healer spells, Bard songs)', 'Healers get direct healing spells with limits. Bards get songs that buff regen like potions and food.', 'Classes', 2),
('Player action logs for balancing', 'Logs to detect issues and analyze game balance — is something too strong?', 'Analytics', 3),
('Non-Player Characters (NPCs)', 'NPCs for quests and to give atmosphere to nodes.', 'NPCs', 4),
('Quest system with AI generation', 'Quests attached to current nodes, with Lovable AI helping generate new quests and nodes.', 'Quests', 5),
('Inn resting for faster HP regen', 'Resting at an Inn node accelerates HP regeneration.', 'Mechanics', 6),
('Unique item rules and repair system', 'Unique items are one-of-a-kind; creature drops common if unique is held. Unique items return after 0 durability or 24h offline. Other items repairable at blacksmith.', 'Items', 7),
('HP regen rate tooltip', 'Tooltip on HP bar explaining the player''s current regen rate.', 'UI', 8),
('Level-difference XP penalty', 'XP penalty when farming creatures much lower level than the player.', 'Mechanics', 9),
('Creature presence indicators on nodes', 'Nodes show dots indicating creature presence — red for aggressive creatures.', 'UI', 10);
