
CREATE OR REPLACE FUNCTION public.sell_item(p_character_id uuid, p_inventory_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv RECORD;
  _char RECORD;
  _cha_total integer;
  _cha_mod integer;
  _sell_mult float;
  _sell_price integer;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  -- Fetch inventory item with item details
  SELECT ci.id AS inv_id, ci.character_id, ci.equipped_slot, ci.is_pinned, i.value, i.is_soulbound, i.name AS item_name
  INTO _inv
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.id = p_inventory_id AND ci.character_id = p_character_id;

  IF _inv IS NULL THEN
    RAISE EXCEPTION 'Item not found in inventory';
  END IF;

  IF _inv.equipped_slot IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot sell equipped items';
  END IF;

  IF _inv.is_soulbound THEN
    RAISE EXCEPTION 'Cannot sell soulbound items';
  END IF;

  -- Calculate effective CHA including equipment bonuses
  SELECT COALESCE(SUM((i.stats->>'cha')::integer), 0)
  INTO _cha_total
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = p_character_id
    AND ci.equipped_slot IS NOT NULL
    AND i.stats ? 'cha';

  _cha_total := _char.cha + _cha_total;

  -- Match client formula: getStatModifier = floor((cha - 10) / 2)
  _cha_mod := GREATEST(0, floor((_cha_total - 10) / 2.0)::integer);
  -- Match client: sellMultiplier = min(0.80, 0.50 + sqrt(mod) * 0.03)
  _sell_mult := LEAST(0.80, 0.50 + sqrt(_cha_mod) * 0.03);
  -- sell price = max(1, floor(value * multiplier))
  _sell_price := GREATEST(1, floor(_inv.value * _sell_mult)::integer);

  -- Delete item and add gold
  DELETE FROM character_inventory WHERE id = p_inventory_id;
  UPDATE characters SET gold = gold + _sell_price WHERE id = p_character_id;

  RETURN _sell_price;
END;
$function$;
