CREATE OR REPLACE FUNCTION public.train_renown_stat(_character_id uuid, _stat text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
  _trained jsonb;
  _rank int;
  _cost int;
  _chance int;
  _roll int;
  _success boolean;
  _new_val int;
BEGIN
  IF NOT owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _stat NOT IN ('str','dex','con','int','wis','cha') THEN
    RAISE EXCEPTION 'Invalid attribute';
  END IF;

  SELECT * INTO _char FROM characters WHERE id = _character_id FOR UPDATE;
  IF _char IS NULL THEN RAISE EXCEPTION 'Character not found'; END IF;
  IF _char.level < 30 THEN RAISE EXCEPTION 'Renown training unlocks at level 30'; END IF;

  _trained := COALESCE(_char.bhp_trained, '{}'::jsonb);
  _rank := COALESCE((_trained->>_stat)::int, 0);
  _cost := 10 * (_rank + 1);
  _chance := GREATEST(5, 95 - _rank * 10);

  IF _char.bhp < _cost THEN RAISE EXCEPTION 'Not enough Renown'; END IF;

  _roll := floor(random() * 100)::int;
  _success := _roll < _chance;

  PERFORM set_config('app.trusted_rpc', 'true', true);

  IF _success THEN
    _trained := jsonb_set(_trained, ARRAY[_stat], to_jsonb(_rank + 1), true);
    EXECUTE format(
      'UPDATE characters SET bhp = bhp - $1, bhp_trained = $2, %I = %I + 1 WHERE id = $3',
      _stat, _stat
    ) USING _cost, _trained, _character_id;
  ELSE
    UPDATE characters SET bhp = bhp - _cost WHERE id = _character_id;
  END IF;

  PERFORM sync_character_resources(_character_id);

  SELECT * INTO _char FROM characters WHERE id = _character_id;
  EXECUTE format('SELECT ($1).%I', _stat) INTO _new_val USING _char;

  RETURN jsonb_build_object(
    'success', _success,
    'stat', _stat,
    'rank', CASE WHEN _success THEN _rank + 1 ELSE _rank END,
    'chance', _chance,
    'cost', _cost,
    'new_value', _new_val,
    'bhp', _char.bhp,
    'bhp_trained', _char.bhp_trained,
    'max_hp', _char.max_hp,
    'max_cp', _char.max_cp,
    'max_mp', _char.max_mp
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.train_renown_stat(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.train_renown_stat(uuid, text) TO authenticated;