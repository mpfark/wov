-- Phase 3: drop legacy character_gems table; gems now live in character_materials.
-- Update materials helpers to stop mirroring to character_gems.

CREATE OR REPLACE FUNCTION public.add_material(_character_id uuid, _key text, _delta integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Mirror salvage into characters.salvage during transition (UI still reads it).
  IF _key = 'salvage' THEN
    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE public.characters SET salvage = COALESCE(salvage, 0) + _delta WHERE id = _character_id;
  END IF;

  RETURN _new_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_material(_character_id uuid, _key text, _delta integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF _key = 'salvage' THEN
    PERFORM set_config('app.trusted_rpc', 'true', true);
    UPDATE public.characters SET salvage = GREATEST(0, COALESCE(salvage, 0) - _delta) WHERE id = _character_id;
  END IF;

  RETURN true;
END;
$function$;

DROP TABLE IF EXISTS public.character_gems;
