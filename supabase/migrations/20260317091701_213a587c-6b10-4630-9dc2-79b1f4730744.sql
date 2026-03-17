
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _stat_delta integer;
  _points_delta integer;
  _respec_delta integer;
BEGIN
  -- === OWNER PATH ===
  IF auth.uid() = NEW.user_id THEN
    -- HARD LOCKS: these fields can NEVER be changed by the owning client
    NEW.level := OLD.level;
    NEW.xp := OLD.xp;
    NEW.race := OLD.race;
    NEW.class := OLD.class;
    NEW.user_id := OLD.user_id;

    -- soulforged_item_created can only go false -> true, never revert
    IF OLD.soulforged_item_created = true THEN
      NEW.soulforged_item_created := true;
    END IF;

    -- Bound checks
    NEW.gold := GREATEST(NEW.gold, 0);
    NEW.hp := LEAST(GREATEST(NEW.hp, 0), NEW.max_hp);
    NEW.cp := LEAST(GREATEST(NEW.cp, 0), NEW.max_cp);
    NEW.mp := LEAST(GREATEST(NEW.mp, 0), NEW.max_mp);
    NEW.str := LEAST(GREATEST(NEW.str, 1), 999);
    NEW.dex := LEAST(GREATEST(NEW.dex, 1), 999);
    NEW.con := LEAST(GREATEST(NEW.con, 1), 999);
    NEW.int := LEAST(GREATEST(NEW.int, 1), 999);
    NEW.wis := LEAST(GREATEST(NEW.wis, 1), 999);
    NEW.cha := LEAST(GREATEST(NEW.cha, 1), 999);

    -- BHP can only decrease (spent on training) or stay same
    IF NEW.bhp > OLD.bhp THEN
      NEW.bhp := OLD.bhp;
    END IF;

    -- Respec points can only decrease or stay same
    IF NEW.respec_points > OLD.respec_points THEN
      NEW.respec_points := OLD.respec_points;
    END IF;

    -- Stat allocation validation:
    -- Net stat change must be funded by unspent_stat_points decrease
    -- OR by a respec (respec_points decreased)
    _stat_delta := (NEW.str - OLD.str) + (NEW.dex - OLD.dex) + (NEW.con - OLD.con)
                 + (NEW.int - OLD.int) + (NEW.wis - OLD.wis) + (NEW.cha - OLD.cha);
    _points_delta := OLD.unspent_stat_points - NEW.unspent_stat_points;
    _respec_delta := OLD.respec_points - NEW.respec_points;

    -- Normal allocation: stats go up, unspent goes down by same amount
    -- Respec: stats change (usually down), unspent goes up, respec_points goes down
    IF _respec_delta <= 0 THEN
      -- Not a respec: stat increase must exactly match points spent
      IF _stat_delta > 0 AND _stat_delta != _points_delta THEN
        -- Revert: don't allow unbalanced stat allocation
        NEW.str := OLD.str;
        NEW.dex := OLD.dex;
        NEW.con := OLD.con;
        NEW.int := OLD.int;
        NEW.wis := OLD.wis;
        NEW.cha := OLD.cha;
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
      -- unspent_stat_points cannot increase without a respec
      IF NEW.unspent_stat_points > OLD.unspent_stat_points THEN
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
    END IF;
    -- If respec_delta > 0 (respec happening), allow stat redistribution freely

    RETURN NEW;
  END IF;

  -- === ADMIN BYPASS ===
  IF is_steward_or_overlord() THEN
    RETURN NEW;
  END IF;

  -- === SERVICE ROLE BYPASS (edge functions) ===
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- === PARTY LEADER PATH: lock all sensitive fields ===
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
