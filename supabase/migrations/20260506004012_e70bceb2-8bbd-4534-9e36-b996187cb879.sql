-- Singleton config for weapon die progression thresholds
CREATE TABLE public.weapon_progression_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  tier1_level INTEGER NOT NULL DEFAULT 11,
  tier2_level INTEGER NOT NULL DEFAULT 21,
  tier3_level INTEGER NOT NULL DEFAULT 31,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT weapon_progression_config_singleton CHECK (id = 1),
  CONSTRAINT weapon_progression_config_order CHECK (
    tier1_level >= 1
    AND tier2_level > tier1_level
    AND tier3_level > tier2_level
  )
);

INSERT INTO public.weapon_progression_config (id, tier1_level, tier2_level, tier3_level)
VALUES (1, 11, 21, 31);

ALTER TABLE public.weapon_progression_config ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read (combat-tick + CharacterPanel need it)
CREATE POLICY "Weapon progression readable by all"
ON public.weapon_progression_config
FOR SELECT
USING (true);

-- Only overlords can update
CREATE POLICY "Overlords can update weapon progression"
ON public.weapon_progression_config
FOR UPDATE
USING (public.has_role(auth.uid(), 'overlord'::app_role));

-- Touch updated_at on change
CREATE OR REPLACE FUNCTION public.touch_weapon_progression_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER weapon_progression_config_touch
BEFORE UPDATE ON public.weapon_progression_config
FOR EACH ROW
EXECUTE FUNCTION public.touch_weapon_progression_config();