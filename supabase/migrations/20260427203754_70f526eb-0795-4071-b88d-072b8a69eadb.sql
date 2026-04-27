-- Renown refactor: add lifetime-earned counter, protect it from client tampering,
-- and update award_party_member to grow it alongside the legacy `bhp` (current Renown balance).

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS rp_total_earned integer NOT NULL DEFAULT 0;

-- Backfill: lifetime ≥ current balance (safe lower bound for existing players).
UPDATE public.characters SET rp_total_earned = bhp WHERE rp_total_earned = 0 AND bhp > 0;

-- ── Trigger guard: clients must never raise rp_total_earned themselves ──
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
    NEW.race := OLD.race;
    NEW.class := OLD.class;
    NEW.user_id := OLD.user_id;

    IF OLD.soulforged_item_created = true THEN
      NEW.soulforged_item_created := true;
    END IF;

    IF NEW.salvage > OLD.salvage AND NOT _trusted THEN
      NEW.salvage := OLD.salvage;
    END IF;

    IF NEW.gold > OLD.gold AND NOT _trusted THEN
      NEW.gold := OLD.gold;
    END IF;

    IF NOT _trusted THEN
      NEW.max_hp := OLD.max_hp;
      NEW.max_cp := OLD.max_cp;
      NEW.max_mp := OLD.max_mp;
      NEW.ac := OLD.ac;
    END IF;

    IF NEW.bhp > OLD.bhp THEN
      NEW.bhp := OLD.bhp;
    END IF;

    -- Lifetime Renown is server-only; clients can only ever see it grow
    -- via trusted RPCs / edge functions.
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
  NEW.rp_total_earned := OLD.rp_total_earned;
  RETURN NEW;
END;
$function$;

-- ── award_party_member: grow rp_total_earned alongside the legacy `bhp` Renown balance ──
CREATE OR REPLACE FUNCTION public.award_party_member(_character_id uuid, _xp integer, _gold integer, _salvage integer DEFAULT 0, _bhp integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _xp < 0 OR _xp > 1000000 THEN
    RAISE EXCEPTION 'Invalid XP amount';
  END IF;
  IF _gold < 0 OR _gold > 1000000 THEN
    RAISE EXCEPTION 'Invalid gold amount';
  END IF;
  IF _salvage < 0 OR _salvage > 1000000 THEN
    RAISE EXCEPTION 'Invalid salvage amount';
  END IF;
  IF _bhp < 0 OR _bhp > 1000000 THEN
    RAISE EXCEPTION 'Invalid Renown amount';
  END IF;

  -- Note: `bhp` is legacy storage for the current Renown balance.
  -- `rp_total_earned` tracks lifetime Renown for the future Renown Board.
  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters
  SET xp = xp + _xp,
      gold = gold + _gold,
      salvage = salvage + _salvage,
      bhp = bhp + _bhp,
      rp_total_earned = rp_total_earned + _bhp
  WHERE id = _character_id;
END;
$function$;