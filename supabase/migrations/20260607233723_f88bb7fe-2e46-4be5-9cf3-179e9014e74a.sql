-- Bond gain per kill + reset prior class bond on switch.

-- Server-side bond gain formula. Centralized so live and offscreen paths agree.
CREATE OR REPLACE FUNCTION public.award_class_bond_for_kill(
  _character_id uuid,
  _creature_level integer,
  _is_boss boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _char RECORD;
  _gain integer;
  _new integer;
  _prev integer;
BEGIN
  SELECT id, class, is_classless INTO _char FROM public.characters WHERE id = _character_id;
  IF _char IS NULL OR _char.is_classless OR _char.class IS NULL THEN
    RETURN 0;
  END IF;

  -- bondGain = clamp(round(level * 0.5 + isBoss * 5), 1, 25)
  _gain := GREATEST(1, LEAST(25,
    round(COALESCE(_creature_level, 1) * 0.5 + CASE WHEN _is_boss THEN 5 ELSE 0 END)::integer
  ));

  SELECT bond INTO _prev FROM public.character_class_bonds
    WHERE character_id = _character_id AND class = _char.class;
  _prev := COALESCE(_prev, 0);

  _new := public.award_class_bond(_character_id, _char.class, _gain);

  -- Log only on crossing a 10-point threshold to avoid spam.
  IF _new IS NOT NULL AND floor(_new / 10.0) > floor(_prev / 10.0) THEN
    INSERT INTO public.activity_log (user_id, character_id, event_type, message, metadata)
    SELECT user_id, _character_id, 'general',
           'Bond with ' || _char.class::text || ' deepens (+' || _gain || ', now ' || _new || ').',
           jsonb_build_object('class', _char.class, 'gain', _gain, 'bond', _new)
    FROM public.characters WHERE id = _character_id;
  END IF;

  RETURN COALESCE(_new, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.award_class_bond_for_kill(uuid, integer, boolean) TO authenticated, service_role;

-- Patch join_order so switching from one class to another resets the prior bond row.
CREATE OR REPLACE FUNCTION public.join_order(_character_id uuid, _class character_class)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _char RECORD;
BEGIN
  IF NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO _char FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF _char IS NULL THEN RAISE EXCEPTION 'Character not found'; END IF;

  -- Switching from an existing class wipes that class's bond row.
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

  INSERT INTO public.activity_log (user_id, character_id, event_type, message, metadata)
  VALUES (auth.uid(), _character_id, 'general',
          'Joined ' || _class::text || ' order', jsonb_build_object('class', _class));

  RETURN jsonb_build_object('class', _class, 'bond', COALESCE(
    (SELECT bond FROM public.character_class_bonds WHERE character_id = _character_id AND class = _class), 0));
END;
$$;