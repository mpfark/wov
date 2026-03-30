
-- Combat sessions table for server-authoritative time-based combat
CREATE TABLE public.combat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id uuid UNIQUE REFERENCES public.characters(id) ON DELETE CASCADE,
  party_id uuid UNIQUE REFERENCES public.parties(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id),
  engaged_creature_ids uuid[] NOT NULL DEFAULT '{}',
  last_tick_at bigint NOT NULL,
  tick_rate_ms integer NOT NULL DEFAULT 2000,
  dots jsonb NOT NULL DEFAULT '{}'::jsonb,
  member_buffs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_owner CHECK (
    (character_id IS NOT NULL AND party_id IS NULL) OR
    (character_id IS NULL AND party_id IS NOT NULL)
  )
);

-- RLS: service role only (edge functions)
ALTER TABLE public.combat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on combat_sessions"
  ON public.combat_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
