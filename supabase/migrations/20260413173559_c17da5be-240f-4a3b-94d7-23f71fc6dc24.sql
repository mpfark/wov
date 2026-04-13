ALTER TABLE public.creatures
ADD COLUMN boss_crit_flavors jsonb NOT NULL DEFAULT '[]'::jsonb;