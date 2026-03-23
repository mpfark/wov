
CREATE OR REPLACE FUNCTION public.inspect_character_equipment(_character_id uuid)
RETURNS TABLE (
  slot text,
  item_name text,
  item_type text,
  rarity text,
  stats jsonb,
  hands smallint,
  durability_pct integer,
  item_level integer,
  description text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ci.equipped_slot::text AS slot,
    i.name AS item_name,
    i.item_type,
    i.rarity::text,
    i.stats,
    i.hands,
    CASE WHEN i.max_durability > 0 THEN (ci.current_durability * 100 / i.max_durability) ELSE 100 END AS durability_pct,
    i.level AS item_level,
    i.description
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = _character_id
    AND ci.equipped_slot IS NOT NULL
  ORDER BY ci.equipped_slot;
$$;
