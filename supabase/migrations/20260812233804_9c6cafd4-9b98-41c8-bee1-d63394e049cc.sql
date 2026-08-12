CREATE OR REPLACE FUNCTION public.encounter_apply_character_damage(_character_id uuid, _amount integer, _source_kind text, _source_creature_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(encounter_id uuid, new_hp integer, old_hp integer, caused_death boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enc uuid;
  v_old_hp int;
  v_new_hp int;
  v_alive boolean;
  v_killed boolean := false;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'encounter_apply_character_damage: _amount must be >= 0 (got %)', _amount;
  END IF;

  v_enc := public.encounter_ensure_for_character(_character_id);
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  SELECT hp INTO v_old_hp
  FROM public.characters
  WHERE id = _character_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_enc, 0, 0, false;
    RETURN;
  END IF;

  v_alive := v_old_hp > 0;
  IF NOT v_alive THEN
    RETURN QUERY SELECT v_enc, 0, v_old_hp, false;
    RETURN;
  END IF;

  v_new_hp := GREATEST(v_old_hp - _amount, 0);
  v_killed := v_new_hp = 0;

  UPDATE public.characters
     SET hp = v_new_hp
   WHERE id = _character_id;

  IF v_killed THEN
    DELETE FROM public.active_effects WHERE target_id = _character_id;
  END IF;

  RETURN QUERY SELECT v_enc, v_new_hp, v_old_hp, v_killed;
END;
$function$;