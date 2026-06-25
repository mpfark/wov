CREATE OR REPLACE FUNCTION public.join_order(_character_id uuid, _class character_class)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _char RECORD;
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF _char IS NULL THEN RAISE EXCEPTION 'Character not found'; END IF;

  IF _char.class IS NOT NULL
     AND _char.is_classless = false
     AND _char.class <> _class THEN
    DELETE FROM public.character_class_bonds
     WHERE character_id = _character_id AND class = _char.class;
  END IF;

  PERFORM set_config('app.trusted_rpc', 'true', true);
  UPDATE public.characters
     SET class = _class,
         is_classless = false,
         reserved_buffs = '{}'::jsonb
   WHERE id = _character_id;

  INSERT INTO public.character_class_bonds (character_id, class, bond)
  VALUES (_character_id, _class, 0)
  ON CONFLICT (character_id, class) DO NOTHING;

  PERFORM public.sync_character_resources(_character_id);

  RETURN jsonb_build_object('class', _class, 'bond', COALESCE(
    (SELECT bond FROM public.character_class_bonds WHERE character_id = _character_id AND class = _class), 0));
END;
$function$;