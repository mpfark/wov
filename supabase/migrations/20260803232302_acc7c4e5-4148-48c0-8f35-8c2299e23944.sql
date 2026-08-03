CREATE OR REPLACE FUNCTION public.grant_starting_materials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.character_materials (character_id, material_key, count)
  VALUES
    (NEW.id, 'salvage', 40),
    (NEW.id, 'garnet', 1),
    (NEW.id, 'topaz', 1),
    (NEW.id, 'emerald', 1),
    (NEW.id, 'sapphire', 1),
    (NEW.id, 'pearl', 1),
    (NEW.id, 'amethyst', 1)
  ON CONFLICT (character_id, material_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_starting_materials ON public.characters;
CREATE TRIGGER trg_grant_starting_materials
AFTER INSERT ON public.characters
FOR EACH ROW EXECUTE FUNCTION public.grant_starting_materials();