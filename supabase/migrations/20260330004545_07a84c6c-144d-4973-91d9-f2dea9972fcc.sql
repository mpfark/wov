
-- Step 1: Create the active_effects table
CREATE TABLE public.active_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL,
  target_id uuid NOT NULL,
  source_id uuid NOT NULL,
  session_id uuid,
  effect_type text NOT NULL,
  stacks integer NOT NULL DEFAULT 1,
  damage_per_tick integer NOT NULL,
  next_tick_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  tick_rate_ms integer NOT NULL DEFAULT 2000,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, target_id, effect_type)
);

-- RLS: service_role only
ALTER TABLE public.active_effects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on active_effects"
  ON public.active_effects
  FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for efficient catch-up queries
CREATE INDEX idx_active_effects_node_id ON public.active_effects (node_id);

-- Step 2: Drop the dots column from combat_sessions
ALTER TABLE public.combat_sessions DROP COLUMN dots;
