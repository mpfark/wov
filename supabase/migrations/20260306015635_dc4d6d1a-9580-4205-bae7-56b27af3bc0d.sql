
CREATE OR REPLACE FUNCTION public.return_unique_items()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delete unique items from characters who have been offline for 6+ hours
  DELETE FROM public.character_inventory
  WHERE id IN (
    SELECT ci.id
    FROM public.character_inventory ci
    JOIN public.items i ON ci.item_id = i.id
    JOIN public.characters c ON ci.character_id = c.id
    WHERE i.rarity = 'unique'
      AND c.last_online < now() - interval '6 hours'
  );
  
  -- Also delete destroyed unique items (durability <= 0)
  DELETE FROM public.character_inventory
  WHERE id IN (
    SELECT ci.id
    FROM public.character_inventory ci
    JOIN public.items i ON ci.item_id = i.id
    WHERE i.rarity = 'unique'
      AND ci.current_durability <= 0
  );
END;
$function$;
