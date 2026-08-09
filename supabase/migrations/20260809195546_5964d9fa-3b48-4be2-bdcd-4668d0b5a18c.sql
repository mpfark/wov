CREATE TABLE public.races (
  race_key text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  str integer NOT NULL DEFAULT 0,
  dex integer NOT NULL DEFAULT 0,
  con integer NOT NULL DEFAULT 0,
  int integer NOT NULL DEFAULT 0,
  wis integer NOT NULL DEFAULT 0,
  cha integer NOT NULL DEFAULT 0,
  portrait_notes text NOT NULL DEFAULT '',
  is_selectable boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  sort_order integer NOT NULL DEFAULT 0,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.races TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.races TO authenticated;
GRANT ALL ON public.races TO service_role;

ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Races are viewable by everyone"
  ON public.races FOR SELECT USING (true);

CREATE POLICY "Admins can insert races"
  ON public.races FOR INSERT TO authenticated
  WITH CHECK (public.is_steward_or_overlord());

CREATE POLICY "Admins can update races"
  ON public.races FOR UPDATE TO authenticated
  USING (public.is_steward_or_overlord())
  WITH CHECK (public.is_steward_or_overlord());

CREATE POLICY "Admins can delete races"
  ON public.races FOR DELETE TO authenticated
  USING (public.is_steward_or_overlord());

CREATE TRIGGER trg_races_updated_at
  BEFORE UPDATE ON public.races
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.races (race_key, label, description, str, dex, con, int, wis, cha, sort_order) VALUES
  ('human', 'Human', 'Versatile and balanced — a small bonus to every stat makes Men adaptable to any class.', 1, 1, 1, 1, 1, 1, 10),
  ('elf', 'Elf', 'Keen-eyed and wise. High DEX sharpens accuracy, AC and crit range; high WIS deepens the CP pool and resists incoming crits.', -1, 2, -1, 2, 3, 0, 20),
  ('dwarf', 'Dwarf', 'Stout and unshakeable. Towering CON gives the largest HP pool in the world, and STR fuels heavy weapons and shield blocks.', 2, -1, 4, 0, 1, -2, 30),
  ('halfling', 'Halfling', 'Quick, lucky and likeable. Top-tier DEX for hits and dodging blows, with CHA boosting gold and vendor prices.', -2, 3, 1, 0, 1, 2, 40),
  ('edain', 'Edain', 'Long-lived nobles of the Old Kingdom. Strong CON for survivability with balanced bonuses across the board.', 1, 0, 3, 1, 1, 1, 50),
  ('half_elf', 'Half-Elf', 'Diplomats and wanderers. WIS fortifies your CP pool and crit defence while CHA earns better gold and trade rates.', 0, 1, 0, 1, 2, 3, 60);

-- Characters reference races by key so new races can be added at runtime.
ALTER TABLE public.characters
  ALTER COLUMN race TYPE text USING race::text;

ALTER TABLE public.characters
  ADD CONSTRAINT characters_race_fkey FOREIGN KEY (race)
  REFERENCES public.races(race_key) ON UPDATE CASCADE;