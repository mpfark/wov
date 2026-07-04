ALTER TABLE public.loot_pool_config
  ADD COLUMN IF NOT EXISTS drop_chance_regular numeric NOT NULL DEFAULT 0.35,
  ADD COLUMN IF NOT EXISTS drop_chance_rare numeric NOT NULL DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS drop_chance_boss numeric NOT NULL DEFAULT 1.00;