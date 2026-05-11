-- Materials catalog and per-character inventory.

CREATE TABLE public.materials (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT '',
  rarity text NOT NULL DEFAULT 'common',
  category text NOT NULL DEFAULT 'scrap',
  tradeable boolean NOT NULL DEFAULT true,
  stack_max integer,
  value integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view materials" ON public.materials
  FOR SELECT USING (true);
CREATE POLICY "Admins manage materials" ON public.materials
  FOR ALL USING (is_steward_or_overlord()) WITH CHECK (is_steward_or_overlord());

CREATE TABLE public.character_materials (
  character_id uuid NOT NULL,
  material_key text NOT NULL REFERENCES public.materials(key) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, material_key)
);

ALTER TABLE public.character_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view materials"
  ON public.character_materials FOR SELECT
  USING (owns_character(character_id) OR is_steward_or_overlord());

CREATE POLICY "Service role full access on character_materials"
  ON public.character_materials FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX character_materials_character_idx ON public.character_materials(character_id);

-- Seed catalog: salvage + 12 gems
INSERT INTO public.materials (key, name, description, icon, rarity, category, tradeable, value, sort_order) VALUES
  ('salvage',    'Salvage',    'Scrap recovered from creatures, used for forging and gem cutting.', '🔩', 'common', 'scrap', true, 1, 0),
  ('garnet',     'Garnet',     'Primary gem aligned with Strength.',     '💎', 'common', 'gem', true, 25, 100),
  ('topaz',      'Topaz',      'Primary gem aligned with Dexterity.',    '💎', 'common', 'gem', true, 25, 101),
  ('emerald',    'Emerald',    'Primary gem aligned with Constitution.', '💎', 'common', 'gem', true, 25, 102),
  ('sapphire',   'Sapphire',   'Primary gem aligned with Intelligence.', '💎', 'common', 'gem', true, 25, 103),
  ('pearl',      'Pearl',      'Primary gem aligned with Wisdom.',       '💎', 'common', 'gem', true, 25, 104),
  ('amethyst',   'Amethyst',   'Primary gem aligned with Charisma.',     '💎', 'common', 'gem', true, 25, 105),
  ('citrine',    'Citrine',    'Hybrid gem fused from STR + DEX.',  '✨', 'uncommon', 'gem', true, 75, 200),
  ('jade',       'Jade',       'Hybrid gem fused from DEX + CON.',  '✨', 'uncommon', 'gem', true, 75, 201),
  ('aquamarine', 'Aquamarine', 'Hybrid gem fused from CON + INT.',  '✨', 'uncommon', 'gem', true, 75, 202),
  ('opal',       'Opal',       'Hybrid gem fused from INT + WIS.',  '✨', 'uncommon', 'gem', true, 75, 203),
  ('moonstone',  'Moonstone',  'Hybrid gem fused from WIS + CHA.',  '✨', 'uncommon', 'gem', true, 75, 204),
  ('sunstone',   'Sunstone',   'Hybrid gem fused from CHA + STR.',  '✨', 'uncommon', 'gem', true, 75, 205);

-- Helper: add_material — positive deltas only.
CREATE OR REPLACE FUNCTION public.add_material(_character_id uuid, _key text, _delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_count integer;
BEGIN
  IF _delta IS NULL OR _delta <= 0 THEN
    RAISE EXCEPTION 'add_material requires a positive delta (got %)', _delta;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE key = _key) THEN
    RAISE EXCEPTION 'Unknown material key: %', _key;
  END IF;

  INSERT INTO public.character_materials (character_id, material_key, count, updated_at)
  VALUES (_character_id, _key, _delta, now())
  ON CONFLICT (character_id, material_key)
  DO UPDATE SET count = character_materials.count + _delta, updated_at = now()
  RETURNING count INTO _new_count;

  RETURN _new_count;
END;
$$;

-- Helper: consume_material — sole writer for reductions; atomic; returns false if balance insufficient.
CREATE OR REPLACE FUNCTION public.consume_material(_character_id uuid, _key text, _delta integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current integer;
BEGIN
  IF _delta IS NULL OR _delta <= 0 THEN
    RAISE EXCEPTION 'consume_material requires a positive delta (got %)', _delta;
  END IF;

  SELECT count INTO _current
  FROM public.character_materials
  WHERE character_id = _character_id AND material_key = _key
  FOR UPDATE;

  IF _current IS NULL OR _current < _delta THEN
    RETURN false;
  END IF;

  UPDATE public.character_materials
  SET count = count - _delta, updated_at = now()
  WHERE character_id = _character_id AND material_key = _key;

  RETURN true;
END;
$$;

-- Backfill from legacy storage.
INSERT INTO public.character_materials (character_id, material_key, count)
SELECT id, 'salvage', salvage FROM public.characters WHERE salvage > 0
ON CONFLICT (character_id, material_key) DO UPDATE SET count = EXCLUDED.count;

INSERT INTO public.character_materials (character_id, material_key, count)
SELECT character_id, gem_key, count FROM public.character_gems WHERE count > 0
ON CONFLICT (character_id, material_key) DO UPDATE SET count = EXCLUDED.count;

-- Realtime publication.
ALTER PUBLICATION supabase_realtime ADD TABLE public.character_materials;