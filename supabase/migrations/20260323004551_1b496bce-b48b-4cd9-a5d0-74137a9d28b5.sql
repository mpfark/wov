
-- 1. Add max bounds to restrict_party_leader_updates trigger
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

    -- Salvage can only decrease (spent at blacksmith) or stay same
    IF NEW.salvage > OLD.salvage THEN
      NEW.salvage := OLD.salvage;
    END IF;

    -- Gold can only decrease (spent at vendor/blacksmith) or stay same
    IF NEW.gold > OLD.gold THEN
      NEW.gold := OLD.gold;
    END IF;

    -- Lock max_hp, max_cp, max_mp, ac to current values (only server can change these)
    NEW.max_hp := OLD.max_hp;
    NEW.max_cp := OLD.max_cp;
    NEW.max_mp := OLD.max_mp;
    NEW.ac := OLD.ac;

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

    -- Stat allocation validation
    _stat_delta := (NEW.str - OLD.str) + (NEW.dex - OLD.dex) + (NEW.con - OLD.con)
                 + (NEW.int - OLD.int) + (NEW.wis - OLD.wis) + (NEW.cha - OLD.cha);
    _points_delta := OLD.unspent_stat_points - NEW.unspent_stat_points;
    _respec_delta := OLD.respec_points - NEW.respec_points;

    IF _respec_delta <= 0 THEN
      IF _stat_delta > 0 AND _stat_delta != _points_delta THEN
        NEW.str := OLD.str;
        NEW.dex := OLD.dex;
        NEW.con := OLD.con;
        NEW.int := OLD.int;
        NEW.wis := OLD.wis;
        NEW.cha := OLD.cha;
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
      IF NEW.unspent_stat_points > OLD.unspent_stat_points THEN
        NEW.unspent_stat_points := OLD.unspent_stat_points;
      END IF;
    END IF;

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
  NEW.salvage := OLD.salvage;
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

-- 2. Create sell_item RPC
CREATE OR REPLACE FUNCTION public.sell_item(p_character_id uuid, p_inventory_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv RECORD;
  _char RECORD;
  _cha_mod integer;
  _sell_mult float;
  _sell_price integer;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  -- Fetch inventory item with item details
  SELECT ci.id AS inv_id, ci.character_id, ci.equipped_slot, i.value, i.is_soulbound, i.name AS item_name
  INTO _inv
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.id = p_inventory_id AND ci.character_id = p_character_id;

  IF _inv IS NULL THEN
    RAISE EXCEPTION 'Item not found in inventory';
  END IF;

  IF _inv.equipped_slot IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot sell equipped items';
  END IF;

  IF _inv.is_soulbound THEN
    RAISE EXCEPTION 'Cannot sell soulbound items';
  END IF;

  -- Calculate CHA sell multiplier server-side
  -- getStatModifier = floor((cha - 10) / 2)
  _cha_mod := GREATEST(0, floor((_char.cha - 10) / 2.0)::integer);
  -- sellMultiplier = min(1.0, 0.40 + sqrt(mod) * 0.05)
  _sell_mult := LEAST(1.0, 0.40 + sqrt(_cha_mod) * 0.05);
  -- sell price = max(1, floor(value * multiplier))
  _sell_price := GREATEST(1, floor(_inv.value * _sell_mult)::integer);

  -- Delete item and add gold
  DELETE FROM character_inventory WHERE id = p_inventory_id;
  UPDATE characters SET gold = gold + _sell_price WHERE id = p_character_id;

  RETURN _sell_price;
END;
$function$;
