
-- Atomic function to acquire a unique item, preventing race conditions
CREATE OR REPLACE FUNCTION public.try_acquire_unique_item(
  p_character_id uuid,
  p_item_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller owns this character
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Serialize access to this specific unique item
  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || p_item_id::text));

  -- Check if anyone currently holds this item
  IF EXISTS (
    SELECT 1 FROM character_inventory
    WHERE item_id = p_item_id
  ) THEN
    RETURN false;
  END IF;

  -- Safe to insert
  INSERT INTO character_inventory (character_id, item_id, current_durability)
  VALUES (p_character_id, p_item_id, 100);

  RETURN true;
END;
$$;
