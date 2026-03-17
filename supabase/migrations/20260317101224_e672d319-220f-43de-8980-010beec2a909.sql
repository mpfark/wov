
-- Update pickup_ground_loot to handle unique items with advisory lock protection
CREATE OR REPLACE FUNCTION public.pickup_ground_loot(p_loot_id uuid, p_character_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _loot RECORD;
  _char_node uuid;
  _item_rarity text;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT current_node_id INTO _char_node FROM characters WHERE id = p_character_id;

  -- Lock and fetch the loot row
  SELECT * INTO _loot FROM node_ground_loot WHERE id = p_loot_id FOR UPDATE;
  IF _loot IS NULL THEN
    RETURN false;
  END IF;

  IF _loot.node_id != _char_node THEN
    RAISE EXCEPTION 'Character is not at this node';
  END IF;

  -- Check item rarity for unique handling
  SELECT rarity INTO _item_rarity FROM items WHERE id = _loot.item_id;

  IF _item_rarity = 'unique' THEN
    -- Advisory lock to prevent duplicate unique items
    PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || _loot.item_id::text));
    IF EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _loot.item_id) THEN
      RETURN false;
    END IF;
  END IF;

  DELETE FROM node_ground_loot WHERE id = p_loot_id;

  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _loot.item_id, 100);

  RETURN true;
END;
$$;
