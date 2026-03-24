CREATE TABLE public.forge_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  slot public.item_slot NOT NULL,
  rarity public.item_rarity NOT NULL DEFAULT 'common',
  level integer NOT NULL DEFAULT 1,
  hands smallint,
  stats jsonb NOT NULL DEFAULT '{}',
  value integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.forge_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view forge pool" ON public.forge_pool FOR SELECT USING (true);
CREATE POLICY "Admins can manage forge pool" ON public.forge_pool FOR ALL USING (public.is_steward_or_overlord());