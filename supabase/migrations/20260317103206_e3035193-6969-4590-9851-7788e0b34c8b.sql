
CREATE OR REPLACE FUNCTION public.buy_vendor_item(p_character_id uuid, p_vendor_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _vi RECORD;
  _char RECORD;
  _cha_mod integer;
  _discount float;
  _final_price integer;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  SELECT * INTO _vi FROM vendor_inventory WHERE id = p_vendor_item_id AND node_id = _char.current_node_id;
  IF _vi IS NULL THEN
    RAISE EXCEPTION 'Item not found at vendor';
  END IF;

  -- Calculate CHA discount server-side
  -- getStatModifier = floor((cha - 10) / 2)
  -- Equipment bonuses are on the character's effective stats already tracked client-side,
  -- but we use base cha here for security. To include equipment, we'd need to query inventory.
  -- For simplicity and security, use base cha from the characters table.
  _cha_mod := GREATEST(0, floor((_char.cha - 10) / 2.0)::integer);
  -- buyDiscount = min(0.10, sqrt(mod) * 0.02)
  _discount := LEAST(0.10, sqrt(_cha_mod) * 0.02);
  -- final price = max(1, floor(base_price * (1 - discount)))
  _final_price := GREATEST(1, floor(_vi.price * (1.0 - _discount))::integer);

  IF _char.gold < _final_price THEN
    RAISE EXCEPTION 'Not enough gold';
  END IF;

  UPDATE characters SET gold = gold - _final_price WHERE id = p_character_id;

  IF _vi.stock > 0 THEN
    UPDATE vendor_inventory SET stock = stock - 1 WHERE id = p_vendor_item_id;
  END IF;

  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, _vi.item_id, 100);

  RETURN true;
END;
$$;
