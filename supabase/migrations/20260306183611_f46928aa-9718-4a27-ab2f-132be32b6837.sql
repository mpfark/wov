
-- Drop the default before changing the type
ALTER TABLE public.items ALTER COLUMN rarity DROP DEFAULT;

-- Remove 'rare' from item_rarity enum
ALTER TYPE public.item_rarity RENAME TO item_rarity_old;
CREATE TYPE public.item_rarity AS ENUM ('common', 'uncommon', 'unique');
ALTER TABLE public.items ALTER COLUMN rarity TYPE public.item_rarity USING rarity::text::public.item_rarity;
DROP TYPE public.item_rarity_old;

-- Restore default
ALTER TABLE public.items ALTER COLUMN rarity SET DEFAULT 'common'::item_rarity;

-- Update the degrade_party_member_equipment function: only unique items destroyed at 0%
CREATE OR REPLACE FUNCTION public.degrade_party_member_equipment(_character_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _item RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _character_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
      AND pm2.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF random() > 0.25 THEN
    RETURN;
  END IF;

  SELECT ci.id AS inv_id, ci.current_durability, i.rarity, i.name
  INTO _item
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = _character_id
    AND ci.equipped_slot IS NOT NULL
  ORDER BY random()
  LIMIT 1;

  IF _item IS NULL THEN
    RETURN;
  END IF;

  IF _item.current_durability <= 1 THEN
    IF _item.rarity = 'unique' THEN
      DELETE FROM character_inventory WHERE id = _item.inv_id;
    ELSE
      UPDATE character_inventory SET current_durability = 0, equipped_slot = NULL WHERE id = _item.inv_id;
    END IF;
  ELSE
    UPDATE character_inventory SET current_durability = current_durability - 1 WHERE id = _item.inv_id;
  END IF;
END;
$function$;
