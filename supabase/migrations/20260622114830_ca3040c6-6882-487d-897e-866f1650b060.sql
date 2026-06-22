
-- 1) Block client-side rewrites of character_inventory.item_id / character_id
CREATE OR REPLACE FUNCTION public.guard_character_inventory_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _trusted boolean;
BEGIN
  _trusted := coalesce(current_setting('app.trusted_rpc', true), '') = 'true';
  IF _trusted THEN
    RETURN NEW;
  END IF;

  IF NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    RAISE EXCEPTION 'character_inventory.item_id is immutable from the client';
  END IF;
  IF NEW.character_id IS DISTINCT FROM OLD.character_id THEN
    RAISE EXCEPTION 'character_inventory.character_id is immutable from the client';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_character_inventory_columns ON public.character_inventory;
CREATE TRIGGER guard_character_inventory_columns
BEFORE UPDATE ON public.character_inventory
FOR EACH ROW EXECUTE FUNCTION public.guard_character_inventory_columns();

-- 2) Restrict families SELECT to authenticated users
DROP POLICY IF EXISTS "Anyone can view families" ON public.families;
CREATE POLICY "Authenticated users can view families"
ON public.families
FOR SELECT
TO authenticated
USING (true);
