
-- Update sell_item to set a bypass flag before the gold update
CREATE OR REPLACE FUNCTION public.sell_item(p_character_id uuid, p_inventory_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _inv RECORD;
  _char RECORD;
  _cha_total integer;
  _cha_mod integer;
  _sell_mult float;
  _sell_price integer;
BEGIN
  IF NOT owns_character(p_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = p_character_id;

  SELECT ci.id AS inv_id, ci.character_id, ci.equipped_slot, ci.is_pinned, i.value, i.is_soulbound, i.name AS item_name
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

  SELECT COALESCE(SUM((i.stats->>'cha')::integer), 0)
  INTO _cha_total
  FROM character_inventory ci
  JOIN items i ON i.id = ci.item_id
  WHERE ci.character_id = p_character_id
    AND ci.equipped_slot IS NOT NULL
    AND i.stats ? 'cha';

  _cha_total := _char.cha + _cha_total;
  _cha_mod := GREATEST(0, floor((_cha_total - 10) / 2.0)::integer);
  _sell_mult := LEAST(0.80, 0.50 + sqrt(_cha_mod) * 0.03);
  _sell_price := GREATEST(1, floor(_inv.value * _sell_mult)::integer);

  DELETE FROM character_inventory WHERE id = p_inventory_id;

  -- Set bypass flag so the trigger allows gold increase from this trusted RPC
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters SET gold = gold + _sell_price WHERE id = p_character_id;

  RETURN _sell_price;
END;
$function$;

-- Update the trigger to respect the bypass flag
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
  _trusted boolean;
BEGIN
  -- Check if a trusted RPC set the bypass flag
  _trusted := coalesce(current_setting('app.trusted_rpc', true), '') = 'true';

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
    -- Unless a trusted RPC is making the change
    IF NEW.salvage > OLD.salvage AND NOT _trusted THEN
      NEW.salvage := OLD.salvage;
    END IF;

    -- Gold can only decrease (spent at vendor/blacksmith) or stay same
    -- Unless a trusted RPC is making the change
    IF NEW.gold > OLD.gold AND NOT _trusted THEN
      NEW.gold := OLD.gold;
    END IF;

    -- Lock max_hp, max_cp, max_mp, ac to current values (only server can change these)
    NEW.max_hp := OLD.max_hp;
    NEW.max_cp := OLD.max_cp;
    NEW.max_mp := OLD.max_mp;
    NEW.ac := OLD.ac;

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

    -- Absolute upper-bound clamping (defense in depth)
    NEW.gold := GREATEST(NEW.gold, 0);
    NEW.ac := LEAST(GREATEST(NEW.ac, 1), 100);
    NEW.max_hp := LEAST(GREATEST(NEW.max_hp, 1), 10000);
    NEW.max_cp := LEAST(GREATEST(NEW.max_cp, 0), 5000);
    NEW.max_mp := LEAST(GREATEST(NEW.max_mp, 0), 5000);
    NEW.hp := LEAST(GREATEST(NEW.hp, 0), NEW.max_hp);
    NEW.cp := LEAST(GREATEST(NEW.cp, 0), NEW.max_cp);
    NEW.mp := LEAST(GREATEST(NEW.mp, 0), NEW.max_mp);
    NEW.str := LEAST(GREATEST(NEW.str, 1), 999);
    NEW.dex := LEAST(GREATEST(NEW.dex, 1), 999);
    NEW.con := LEAST(GREATEST(NEW.con, 1), 999);
    NEW.int := LEAST(GREATEST(NEW.int, 1), 999);
    NEW.wis := LEAST(GREATEST(NEW.wis, 1), 999);
    NEW.cha := LEAST(GREATEST(NEW.cha, 1), 999);

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
