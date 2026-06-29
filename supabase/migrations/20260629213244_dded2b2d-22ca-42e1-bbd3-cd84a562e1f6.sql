
DO $$
DECLARE
  r RECORD;
  gem TEXT;
  qty INT;
BEGIN
  FOR r IN
    SELECT id, character_id, applied_gems
    FROM character_inventory
    WHERE applied_gems IS NOT NULL
      AND applied_gems <> '{}'::jsonb
  LOOP
    FOR gem, qty IN SELECT key, (value)::int FROM jsonb_each_text(r.applied_gems) LOOP
      IF qty IS NOT NULL AND qty > 0 THEN
        INSERT INTO character_materials (character_id, material_key, count)
        VALUES (r.character_id, gem, qty)
        ON CONFLICT (character_id, material_key)
        DO UPDATE SET count = character_materials.count + EXCLUDED.count, updated_at = now();
      END IF;
    END LOOP;
  END LOOP;
END$$;

UPDATE character_inventory
SET applied_gems = '{}'::jsonb,
    stat_override = NULL
WHERE applied_gems IS DISTINCT FROM '{}'::jsonb
   OR stat_override IS NOT NULL;

DROP FUNCTION IF EXISTS public.inspect_character_equipment(uuid);

CREATE FUNCTION public.inspect_character_equipment(_character_id uuid)
 RETURNS TABLE(
   slot text, item_name text, item_type text, rarity text,
   stats jsonb, hands smallint, durability_pct integer, item_level integer,
   description text, illustration_url text,
   weapon_tag text, is_soulbound boolean,
   applied_gems jsonb, stat_override jsonb
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    ci.equipped_slot::text AS slot,
    i.name AS item_name,
    i.item_type,
    i.rarity::text,
    i.stats,
    i.hands,
    CASE WHEN i.max_durability > 0 THEN (ci.current_durability * 100 / i.max_durability) ELSE 100 END AS durability_pct,
    i.level AS item_level,
    i.description,
    i.illustration_url,
    i.weapon_tag::text,
    i.is_soulbound,
    ci.applied_gems,
    ci.stat_override
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = _character_id
    AND ci.equipped_slot IS NOT NULL
  ORDER BY ci.equipped_slot;
$function$;
