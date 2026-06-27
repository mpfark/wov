ALTER TABLE public.combat_sessions
  ADD COLUMN IF NOT EXISTS recent_member_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.combat_sessions.recent_member_ids IS
  'Map character_id -> { last_at_node_ms } recording when each party member was last observed at the session node. Used by combat-tick to grant a brief grace window so members who walk off the node milliseconds before a kill still receive XP/loot.';