
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- If the user owns this character, allow all updates
  IF auth.uid() = NEW.user_id THEN
    RETURN NEW;
  END IF;

  -- If the caller is a steward or overlord (admin), allow all updates
  IF is_steward_or_overlord() THEN
    RETURN NEW;
  END IF;

  -- Also allow service-role calls (auth.uid() is null, e.g. edge functions)
  IF auth.uid() IS NULL THEN
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
$function$;
