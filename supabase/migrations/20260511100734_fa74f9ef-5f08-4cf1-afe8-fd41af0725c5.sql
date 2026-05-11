-- Dual-write helpers: maintain legacy salvage column and character_gems for backward compat.
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

  -- Mirror into legacy storage during transition.
  IF _key = 'salvage' THEN
    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE public.characters SET salvage = COALESCE(salvage, 0) + _delta WHERE id = _character_id;
  ELSE
    INSERT INTO public.character_gems (character_id, gem_key, count, updated_at)
    VALUES (_character_id, _key, _delta, now())
    ON CONFLICT (character_id, gem_key)
    DO UPDATE SET count = character_gems.count + _delta, updated_at = now();
  END IF;

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

  -- Mirror into legacy storage.
  IF _key = 'salvage' THEN
    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE public.characters SET salvage = GREATEST(0, COALESCE(salvage, 0) - _delta) WHERE id = _character_id;
  ELSE
    UPDATE public.character_gems
    SET count = GREATEST(0, count - _delta), updated_at = now()
    WHERE character_id = _character_id AND gem_key = _key;
  END IF;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_material(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_material(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_material(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_material(uuid, text, integer) TO service_role;

-- Route award_party_member's salvage path through add_material so the new
-- materials table reflects every kill reward.
CREATE OR REPLACE FUNCTION public.award_party_member(_character_id uuid, _xp integer, _gold integer, _salvage integer DEFAULT 0, _bhp integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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