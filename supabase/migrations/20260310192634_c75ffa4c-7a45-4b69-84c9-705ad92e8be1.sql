
-- Add BHP columns to characters
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS bhp integer NOT NULL DEFAULT 0;
ALTER TABLE public.characters ADD COLUMN IF NOT EXISTS bhp_trained jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add is_trainer flag to nodes
ALTER TABLE public.nodes ADD COLUMN IF NOT EXISTS is_trainer boolean NOT NULL DEFAULT false;

-- Update restrict_party_leader_updates to protect bhp fields
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() = NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF is_steward_or_overlord() THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
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
  NEW.cp := OLD.cp;
  NEW.max_cp := OLD.max_cp;
  NEW.bhp := OLD.bhp;
  NEW.bhp_trained := OLD.bhp_trained;
  RETURN NEW;
END;
$function$;
