ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS last_death_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_death_log jsonb;