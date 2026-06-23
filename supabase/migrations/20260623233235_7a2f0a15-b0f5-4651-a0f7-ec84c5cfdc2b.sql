ALTER TABLE public.characters DROP CONSTRAINT IF EXISTS wimp_hp_threshold_range;
ALTER TABLE public.characters ADD CONSTRAINT wimp_hp_threshold_nonneg CHECK (wimp_hp_threshold >= 0);