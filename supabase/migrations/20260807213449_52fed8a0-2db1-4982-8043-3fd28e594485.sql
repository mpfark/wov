ALTER TABLE public.node_ground_loot
  ADD COLUMN IF NOT EXISTS applied_gems jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stat_override jsonb,
  ADD COLUMN IF NOT EXISTS current_durability integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS crafted_level integer;

CREATE OR REPLACE FUNCTION public.drop_item_to_ground(p_inventory_id uuid, p_character_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inv RECORD;
  _char_node uuid;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT ci.item_id, i.is_soulbound, ci.applied_gems, ci.stat_override,
         ci.current_durability, ci.crafted_level
    INTO _inv
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.id = p_inventory_id AND ci.character_id = p_character_id;

  IF _inv IS NULL THEN
    RETURN false;
  END IF;

  IF _inv.is_soulbound THEN
    RAISE EXCEPTION 'Cannot drop soulbound items';
  END IF;

  SELECT current_node_id INTO _char_node FROM characters WHERE id = p_character_id;

  DELETE FROM character_inventory WHERE id = p_inventory_id;

  INSERT INTO node_ground_loot (node_id, item_id, dropped_by, applied_gems, stat_override, current_durability, crafted_level)
  VALUES (_char_node, _inv.item_id, p_character_id,
          COALESCE(_inv.applied_gems, '[]'::jsonb), _inv.stat_override,
          COALESCE(_inv.current_durability, 100), _inv.crafted_level);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.pickup_ground_loot(p_loot_id uuid, p_character_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT * INTO _loot FROM node_ground_loot WHERE id = p_loot_id FOR UPDATE;
  IF _loot IS NULL THEN
    RETURN false;
  END IF;

  IF _loot.node_id != _char_node THEN
    RAISE EXCEPTION 'Character is not at this node';
  END IF;

  SELECT rarity INTO _item_rarity FROM items WHERE id = _loot.item_id;

  IF _item_rarity = 'unique' THEN
    PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || _loot.item_id::text));
    IF EXISTS (SELECT 1 FROM character_inventory WHERE item_id = _loot.item_id) THEN
      RETURN false;
    END IF;
  END IF;

  DELETE FROM node_ground_loot WHERE id = p_loot_id;

  INSERT INTO character_inventory (character_id, item_id, current_durability, applied_gems, stat_override, crafted_level)
  VALUES (p_character_id, _loot.item_id, COALESCE(_loot.current_durability, 100),
          COALESCE(_loot.applied_gems, '[]'::jsonb), _loot.stat_override, _loot.crafted_level);

  RETURN true;
END;
$$;