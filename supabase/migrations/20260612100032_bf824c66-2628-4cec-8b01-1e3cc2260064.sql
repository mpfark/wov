CREATE OR REPLACE FUNCTION public.stonebinder_commit_fuse(p_character_id uuid, p_source_inv_a uuid, p_source_inv_b uuid, p_ascended_item_id uuid, p_durability integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_inv_id uuid;
  _exists boolean;
  _deleted_count int;
BEGIN
  IF NOT public.owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('unique_item_' || p_ascended_item_id::text));

  SELECT
    EXISTS (SELECT 1 FROM public.character_inventory WHERE item_id = p_ascended_item_id)
    OR EXISTS (
      SELECT 1 FROM public.marketplace_listings
      WHERE item_id = p_ascended_item_id AND status = 'active'
    )
    OR EXISTS (SELECT 1 FROM public.node_ground_loot WHERE item_id = p_ascended_item_id)
  INTO _exists;

  IF _exists THEN
    RAISE EXCEPTION 'That ascended stone already exists in the world.'
      USING ERRCODE = 'unique_violation';
  END IF;

  WITH deleted AS (
    DELETE FROM public.character_inventory
    WHERE id IN (p_source_inv_a, p_source_inv_b)
      AND character_id = p_character_id
      AND equipped_slot IS NULL
    RETURNING id
  )
  SELECT count(*)::int INTO _deleted_count FROM deleted;

  IF _deleted_count <> 2 THEN
    RAISE EXCEPTION 'Source stones not available (already used or equipped).';
  END IF;

  INSERT INTO public.character_inventory (character_id, item_id, equipped_slot, current_durability)
  VALUES (p_character_id, p_ascended_item_id, NULL, COALESCE(p_durability, 100))
  RETURNING id INTO _new_inv_id;

  RETURN _new_inv_id;
END;
$function$;