ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS wimp_hp_threshold integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wimp_direction text;
ALTER TABLE public.characters
  ADD CONSTRAINT wimp_hp_threshold_range CHECK (wimp_hp_threshold >= 0 AND wimp_hp_threshold <= 100);