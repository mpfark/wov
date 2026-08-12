ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS tick_owner text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.encounters
  DROP CONSTRAINT IF EXISTS encounters_tick_owner_check;

ALTER TABLE public.encounters
  ADD CONSTRAINT encounters_tick_owner_check CHECK (tick_owner IN ('legacy', 'shared'));

UPDATE public.encounters SET tick_owner = 'legacy' WHERE tick_owner IS DISTINCT FROM 'shared';

CREATE TABLE IF NOT EXISTS public.combat_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.combat_config TO authenticated;
GRANT ALL ON public.combat_config TO service_role;

ALTER TABLE public.combat_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read combat config" ON public.combat_config;
CREATE POLICY "Authenticated can read combat config"
  ON public.combat_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Overlords manage combat config" ON public.combat_config;
CREATE POLICY "Overlords manage combat config"
  ON public.combat_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'overlord'))
  WITH CHECK (public.has_role(auth.uid(), 'overlord'));

DROP TRIGGER IF EXISTS update_combat_config_updated_at ON public.combat_config;
CREATE TRIGGER update_combat_config_updated_at
  BEFORE UPDATE ON public.combat_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.combat_config (key, value)
VALUES ('tick_owner', 'legacy')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.combat_tick_owner()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT NULLIF(value, '') FROM public.combat_config WHERE key = 'tick_owner'),
    'legacy'
  );
$$;

GRANT EXECUTE ON FUNCTION public.combat_tick_owner() TO authenticated, service_role;