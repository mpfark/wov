
-- Add a trigger to prevent party leaders from modifying sensitive character fields
-- Party leaders should only be able to update current_node_id (for follow movement)
-- All other updates (gold, xp, hp, stats) go through SECURITY DEFINER RPCs

CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If the user owns this character, allow all updates
  IF auth.uid() = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- For non-owners (party leaders), only allow current_node_id and last_online changes
  -- Revert all other fields to their old values
  NEW.name := OLD.name;
  NEW.race := OLD.race;
  NEW.class := OLD.class;
  NEW.level := OLD.level;
  NEW.xp := OLD.xp;
  NEW.hp := OLD.hp;
  NEW.max_hp := OLD.max_hp;
  NEW.gold := OLD.gold;
  NEW.str := OLD.str;
  NEW.dex := OLD.dex;
  NEW.con := OLD.con;
  NEW.int := OLD.int;
  NEW.wis := OLD.wis;
  NEW.cha := OLD.cha;
  NEW.ac := OLD.ac;
  NEW.unspent_stat_points := OLD.unspent_stat_points;
  NEW.user_id := OLD.user_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER restrict_party_leader_character_updates
BEFORE UPDATE ON public.characters
FOR EACH ROW
EXECUTE FUNCTION public.restrict_party_leader_updates();
