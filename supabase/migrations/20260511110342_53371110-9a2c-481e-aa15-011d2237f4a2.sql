-- Phase 4: drop characters.salvage entirely. Salvage lives in character_materials.

-- 1. Stop mirroring salvage in the materials helpers.
CREATE OR REPLACE FUNCTION public.add_material(_character_id uuid, _key text, _delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_count integer;
BEGIN
  IF _delta IS NULL OR _delta <= 0 THEN
    RAISE EXCEPTION 'add_material requires a positive delta (got %)', _delta;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.materials WHERE key = _key) THEN
    RAISE EXCEPTION 'Unknown material key: %', _key;
  END IF;

  INSERT INTO public.character_materials (character_id, material_key, count, updated_at)
  VALUES (_character_id, _key, _delta, now())
  ON CONFLICT (character_id, material_key)
  DO UPDATE SET count = character_materials.count + _delta, updated_at = now()
  RETURNING count INTO _new_count;

  RETURN _new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_material(_character_id uuid, _key text, _delta integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current integer;
BEGIN
  IF _delta IS NULL OR _delta <= 0 THEN
    RAISE EXCEPTION 'consume_material requires a positive delta (got %)', _delta;
  END IF;

  SELECT count INTO _current
  FROM public.character_materials
  WHERE character_id = _character_id AND material_key = _key
  FOR UPDATE;

  IF _current IS NULL OR _current < _delta THEN
    RETURN false;
  END IF;

  UPDATE public.character_materials
  SET count = count - _delta, updated_at = now()
  WHERE character_id = _character_id AND material_key = _key;

  RETURN true;
END;
$$;

-- 2. Drop the obsolete 4-arg award_party_member overload that wrote characters.salvage.
DROP FUNCTION IF EXISTS public.award_party_member(uuid, integer, integer, integer);

-- 3. Rewrite the 5-arg award_party_member to drop the salvage column reference
--    (it already routed salvage through add_material in the previous version).
CREATE OR REPLACE FUNCTION public.award_party_member(_character_id uuid, _xp integer, _gold integer, _salvage integer DEFAULT 0, _bhp integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _xp < 0 OR _xp > 1000000 THEN RAISE EXCEPTION 'Invalid XP amount'; END IF;
  IF _gold < 0 OR _gold > 1000000 THEN RAISE EXCEPTION 'Invalid gold amount'; END IF;
  IF _salvage < 0 OR _salvage > 1000000 THEN RAISE EXCEPTION 'Invalid salvage amount'; END IF;
  IF _bhp < 0 OR _bhp > 1000000 THEN RAISE EXCEPTION 'Invalid Renown amount'; END IF;

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE characters
  SET xp = xp + _xp,
      gold = gold + _gold,
      bhp = bhp + _bhp,
      rp_total_earned = rp_total_earned + _bhp
  WHERE id = _character_id;

  IF _salvage > 0 THEN
    PERFORM public.add_material(_character_id, 'salvage', _salvage);
  END IF;
END;
$$;

-- 4. Remove the salvage guard from the character-update trigger.
CREATE OR REPLACE FUNCTION public.restrict_party_leader_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- 5. Finally drop the column.
ALTER TABLE public.characters DROP COLUMN IF EXISTS salvage;
