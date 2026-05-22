CREATE OR REPLACE FUNCTION public.grant_starting_gear(p_character_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _gear RECORD;
  _gem text;
  _primary_gems text[] := ARRAY['garnet','topaz','emerald','sapphire','pearl','amethyst'];
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  -- Grant class-specific starting gear (weapon, equipped to main_hand)
  FOR _gear IN SELECT item_id FROM class_starting_gear WHERE class = _char.class LOOP
    INSERT INTO character_inventory (character_id, item_id, current_durability, equipped_slot)
    VALUES (p_character_id, _gear.item_id, 100, 'main_hand');
  END LOOP;

  -- Forge budget for 6 armor slots at L1: 7 salvage + 5 gold each
  UPDATE characters SET gold = gold + 30 WHERE id = p_character_id;

  INSERT INTO character_materials (character_id, material_key, count)
  VALUES (p_character_id, 'salvage', 42)
  ON CONFLICT (character_id, material_key)
  DO UPDATE SET count = character_materials.count + EXCLUDED.count, updated_at = now();

  FOREACH _gem IN ARRAY _primary_gems LOOP
    INSERT INTO character_materials (character_id, material_key, count)
    VALUES (p_character_id, _gem, 1)
    ON CONFLICT (character_id, material_key)
    DO UPDATE SET count = character_materials.count + EXCLUDED.count, updated_at = now();
  END LOOP;
END;
$function$;