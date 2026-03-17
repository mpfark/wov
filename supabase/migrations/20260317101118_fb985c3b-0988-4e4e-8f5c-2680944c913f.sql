
-- 1. pickup_ground_loot: atomically picks up loot, verifies ownership + location
CREATE OR REPLACE FUNCTION public.pickup_ground_loot(p_loot_id uuid, p_character_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _loot RECORD;
  _char_node uuid;
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

  DELETE FROM node_ground_loot WHERE id = p_loot_id;

  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _loot.item_id, 100);

  RETURN true;
END;
$$;

-- 2. drop_item_to_ground: atomically removes from inventory and drops on ground
CREATE OR REPLACE FUNCTION public.drop_item_to_ground(p_inventory_id uuid, p_character_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _inv RECORD;
  _char_node uuid;
  _is_soulbound boolean;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT ci.item_id, i.is_soulbound INTO _inv
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

  INSERT INTO node_ground_loot (node_id, item_id, dropped_by)
  VALUES (_char_node, _inv.item_id, p_character_id);

  RETURN true;
END;
$$;

-- 3. buy_vendor_item: atomically purchases from vendor
CREATE OR REPLACE FUNCTION public.buy_vendor_item(p_character_id uuid, p_vendor_item_id uuid, p_price integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _vi RECORD;
  _char RECORD;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  SELECT * INTO _vi FROM vendor_inventory WHERE id = p_vendor_item_id AND node_id = _char.current_node_id;
  IF _vi IS NULL THEN
    RAISE EXCEPTION 'Item not found at vendor';
  END IF;

  IF _char.gold < p_price THEN
    RAISE EXCEPTION 'Not enough gold';
  END IF;

  UPDATE characters SET gold = gold - p_price WHERE id = p_character_id;

  IF _vi.stock > 0 THEN
    UPDATE vendor_inventory SET stock = stock - 1 WHERE id = p_vendor_item_id;
  END IF;

  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _vi.item_id, 100);

  RETURN true;
END;
$$;

-- 4. grant_starting_gear: grants class + universal gear on character creation
CREATE OR REPLACE FUNCTION public.grant_starting_gear(p_character_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _char RECORD;
  _gear RECORD;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  -- Grant universal starting gear
  FOR _gear IN SELECT item_id, equipped_slot FROM universal_starting_gear LOOP
    INSERT INTO character_inventory (character_id, item_id, current_durability, equipped_slot)
    VALUES (p_character_id, _gear.item_id, 100, _gear.equipped_slot::item_slot);
  END LOOP;

  -- Grant class-specific starting gear (equipped to main_hand)
  FOR _gear IN SELECT item_id FROM class_starting_gear WHERE class = _char.class LOOP
    INSERT INTO character_inventory (character_id, item_id, current_durability, equipped_slot)
    VALUES (p_character_id, _gear.item_id, 100, 'main_hand');
  END LOOP;
END;
$$;

-- 5. Lock down RLS policies

-- Remove direct INSERT on character_inventory (all inserts now go through RPCs or service role)
DROP POLICY IF EXISTS "Owners can insert inventory" ON public.character_inventory;

-- Remove overly permissive DELETE/INSERT on node_ground_loot
DROP POLICY IF EXISTS "Authenticated users can delete ground loot" ON public.node_ground_loot;
DROP POLICY IF EXISTS "Authenticated users can insert ground loot" ON public.node_ground_loot;

-- Admins can still manage ground loot directly
CREATE POLICY "Admins can manage ground loot"
ON public.node_ground_loot
FOR ALL TO authenticated
USING (is_steward_or_overlord())
WITH CHECK (is_steward_or_overlord());
