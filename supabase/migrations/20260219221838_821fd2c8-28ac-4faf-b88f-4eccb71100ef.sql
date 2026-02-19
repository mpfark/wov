
CREATE OR REPLACE FUNCTION public.update_party_member_hp(_character_id uuid, _new_hp integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Allow any accepted party mate to update HP (not just the leader)
  IF NOT EXISTS (
    SELECT 1 FROM party_members pm1
    JOIN party_members pm2 ON pm1.party_id = pm2.party_id
    WHERE pm1.character_id = _character_id
      AND pm1.status = 'accepted'
      AND pm2.status = 'accepted'
      AND pm2.character_id IN (SELECT id FROM characters WHERE user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized: caller is not in the same party';
  END IF;

  UPDATE characters SET hp = GREATEST(_new_hp, 0) WHERE id = _character_id;
END;
$function$;
