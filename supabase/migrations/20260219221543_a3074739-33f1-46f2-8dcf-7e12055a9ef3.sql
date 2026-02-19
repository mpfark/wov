
CREATE OR REPLACE FUNCTION public.degrade_party_member_equipment(_character_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _item RECORD;
BEGIN
  -- Verify the caller is in the same party as the target
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

  -- 25% chance to degrade a random equipped item
  IF random() > 0.25 THEN
    RETURN;
  END IF;

  -- Pick a random equipped item
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
    -- Rare/unique items are destroyed, common/uncommon unequipped
    IF _item.rarity IN ('rare', 'unique') THEN
      DELETE FROM character_inventory WHERE id = _item.inv_id;
    ELSE
      UPDATE character_inventory SET current_durability = 0, equipped_slot = NULL WHERE id = _item.inv_id;
    END IF;
  ELSE
    UPDATE character_inventory SET current_durability = current_durability - 1 WHERE id = _item.inv_id;
  END IF;
END;
$function$;
