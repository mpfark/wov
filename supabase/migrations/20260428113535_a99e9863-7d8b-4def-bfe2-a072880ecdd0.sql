
CREATE OR REPLACE FUNCTION public.grant_searched_item(p_character_id uuid, p_item_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM items WHERE id = p_item_id) THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, p_item_id, 100);

  RETURN true;
END;
$$;
