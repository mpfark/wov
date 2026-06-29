
ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS active_contract jsonb,
  ADD COLUMN IF NOT EXISTS contracts_completed integer NOT NULL DEFAULT 0;

-- Freeze contract columns from client writes (server RPCs use trusted_rpc bypass).
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
  _trusted := coalesce(current_setting('app.trusted_rpc', true), '') = 'true';

  IF auth.uid() = NEW.user_id THEN
    NEW.level := OLD.level;
    NEW.xp := OLD.xp;
    NEW.user_id := OLD.user_id;

    IF NOT _trusted THEN
      NEW.race := OLD.race;
      NEW.class := OLD.class;
      NEW.is_classless := OLD.is_classless;
    END IF;

    IF OLD.soulforged_item_created = true THEN
      NEW.soulforged_item_created := true;
    END IF;

    IF NOT _trusted THEN
      NEW.soulring_tier := OLD.soulring_tier;
      NEW.soulring_inventory_id := OLD.soulring_inventory_id;
      NEW.king_slayer_at := OLD.king_slayer_at;
    END IF;

    IF NEW.gold > OLD.gold AND NOT _trusted THEN
      NEW.gold := OLD.gold;
    END IF;

    IF NOT _trusted THEN
      NEW.max_hp := OLD.max_hp;
      NEW.max_cp := OLD.max_cp;
      NEW.max_mp := OLD.max_mp;
      NEW.ac := OLD.ac;

      NEW.hp := LEAST(GREATEST(COALESCE(NEW.hp, 0), 0), OLD.max_hp);
      NEW.mp := LEAST(GREATEST(COALESCE(NEW.mp, 0), 0), OLD.max_mp);
      NEW.cp := LEAST(GREATEST(COALESCE(NEW.cp, 0), 0), OLD.max_cp);

      NEW.reserved_buffs := OLD.reserved_buffs;
      NEW.stance_state := OLD.stance_state;

      NEW.bhp_trained := OLD.bhp_trained;

      NEW.family_id := OLD.family_id;
      NEW.family_name := OLD.family_name;
      NEW.family_changed_after_creation := OLD.family_changed_after_creation;

      -- Contract state: server RPCs only.
      NEW.active_contract := OLD.active_contract;
      NEW.contracts_completed := OLD.contracts_completed;
    END IF;

    IF NEW.bhp > OLD.bhp THEN
      NEW.bhp := OLD.bhp;
    END IF;

    IF NEW.rp_total_earned > OLD.rp_total_earned THEN
      NEW.rp_total_earned := OLD.rp_total_earned;
    END IF;

    IF NEW.respec_points > OLD.respec_points THEN
      NEW.respec_points := OLD.respec_points;
    END IF;

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

    NEW.gold := GREATEST(NEW.gold, 0);
    NEW.ac := LEAST(GREATEST(NEW.ac, 1), 100);
    NEW.max_hp := LEAST(GREATEST(NEW.max_hp, 1), 10000);
    NEW.max_cp := LEAST(GREATEST(NEW.max_cp, 0), 5000);
  END IF;

  RETURN NEW;
END;
$function$;

-- Pick a contract target for an assassin.
CREATE OR REPLACE FUNCTION public.assassin_take_contract(_character_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c RECORD;
  _hall_region uuid;
  _pick RECORD;
  _contract jsonb;
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _c FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF _c IS NULL THEN RAISE EXCEPTION 'Character not found'; END IF;
  IF _c.class::text <> 'assassin' THEN
    RAISE EXCEPTION 'Only assassins can take contracts';
  END IF;
  IF _c.active_contract IS NOT NULL THEN
    RAISE EXCEPTION 'You already have an active contract';
  END IF;

  -- Region of the assassin hall (for tie-break preference).
  SELECT region_id INTO _hall_region
    FROM public.nodes WHERE class_hall = 'assassin' LIMIT 1;

  -- Eligible creatures: not boss, within level window, exist on a node with area.
  WITH eligible AS (
    SELECT DISTINCT ON (cr.id)
      cr.id, cr.name, cr.level, cr.rarity,
      n.area_id, a.name AS area_name, n.region_id
    FROM public.creatures cr
    JOIN public.nodes n ON n.id = cr.node_id
    JOIN public.areas a ON a.id = n.area_id
    WHERE cr.rarity <> 'boss'
      AND cr.level BETWEEN GREATEST(1, _c.level - 2) AND (_c.level + 1)
      AND n.area_id IS NOT NULL
  )
  SELECT * INTO _pick FROM eligible
  ORDER BY
    (region_id = _hall_region) DESC,
    abs(level - _c.level),
    random()
  LIMIT 1;

  IF _pick IS NULL THEN
    RAISE EXCEPTION 'No suitable targets found for your level right now';
  END IF;

  _contract := jsonb_build_object(
    'creature_id', _pick.id,
    'creature_name', _pick.name,
    'area_id', _pick.area_id,
    'area_name', _pick.area_name,
    'target_level', _pick.level,
    'rarity', _pick.rarity,
    'issued_at', extract(epoch from now())::bigint
  );

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET active_contract = _contract
   WHERE id = _character_id;

  RETURN _contract;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assassin_abandon_contract(_character_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET active_contract = NULL
   WHERE id = _character_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assassin_take_contract(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assassin_abandon_contract(uuid) TO authenticated;
