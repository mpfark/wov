-- Remove final stale activity_log references
DROP FUNCTION IF EXISTS public.log_activity(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.log_activity(uuid, text, text);
DROP FUNCTION IF EXISTS public.trim_activity_log();

CREATE OR REPLACE FUNCTION public.award_class_bond_for_kill(_character_id uuid, _creature_level integer, _is_boss boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  _gain := GREATEST(1, LEAST(25,
    round(COALESCE(_creature_level, 1) * 0.5 + CASE WHEN _is_boss THEN 5 ELSE 0 END)::integer
  ));

  SELECT bond INTO _prev FROM public.character_class_bonds
    WHERE character_id = _character_id AND class = _char.class;
  _prev := COALESCE(_prev, 0);

  _new := public.award_class_bond(_character_id, _char.class, _gain);

  RETURN COALESCE(_new, 0);
END;
$function$;