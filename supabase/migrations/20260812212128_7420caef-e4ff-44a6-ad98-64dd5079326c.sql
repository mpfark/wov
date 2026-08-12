-- 1) Effective-loadout check helper
CREATE OR REPLACE FUNCTION public.character_can_use_ability(_character_id uuid, _ability_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    -- explicitly equipped
    SELECT 1
    FROM public.character_ability_loadout l
    JOIN public.abilities a ON a.id = l.ability_id
    LEFT JOIN public.class_ability_assignments ca
      ON ca.ability_id = l.ability_id AND ca.role_id = l.role_id
    WHERE l.character_id = _character_id
      AND (a.ability_key = _ability_key OR ca.class_ability_key = _ability_key)
  ) OR EXISTS (
    -- class default in a slot the character has not overridden
    SELECT 1
    FROM public.characters c
    JOIN public.class_ability_assignments ca
      ON ca.class_key = c.class AND ca.status = 'active' AND ca.is_default
    JOIN public.abilities a ON a.id = ca.ability_id AND a.status = 'active'
    WHERE c.id = _character_id
      AND ca.unlock_level <= c.level
      AND (a.ability_key = _ability_key OR ca.class_ability_key = _ability_key)
      AND NOT EXISTS (
        SELECT 1 FROM public.character_ability_loadout l
        WHERE l.character_id = _character_id AND l.role_id = ca.role_id
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.character_can_use_ability(uuid, text) TO authenticated, service_role;

-- 2) submit_combat_action: accept effective loadout
CREATE OR REPLACE FUNCTION public.submit_combat_action(_id uuid, _character_id uuid, _ability_key text, _target_creature_id uuid DEFAULT NULL::uuid, _target_character_id uuid DEFAULT NULL::uuid, _client_seq integer DEFAULT 0)
RETURNS combat_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.combat_actions;
  v_row public.combat_actions;
  v_encounter_id uuid;
  v_node_id uuid;
BEGIN
  SELECT * INTO v_existing FROM public.combat_actions WHERE id = _id;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'not your character';
  END IF;

  SELECT current_node_id INTO v_node_id
  FROM public.characters
  WHERE id = _character_id AND hp > 0;
  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'character unavailable';
  END IF;

  IF NOT public.character_can_use_ability(_character_id, _ability_key) THEN
    RAISE EXCEPTION 'ability not in loadout';
  END IF;

  IF _target_creature_id IS NOT NULL THEN
    v_encounter_id := public.join_encounter_engagement(_character_id, _target_creature_id);
  ELSE
    v_encounter_id := public.encounter_ensure_for_character(_character_id);
    INSERT INTO public.encounter_participants (encounter_id, character_id)
    VALUES (v_encounter_id, _character_id)
    ON CONFLICT (encounter_id, character_id) DO UPDATE SET last_action_at = now();
  END IF;

  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'superseded'
  WHERE character_id = _character_id AND status = 'pending';

  INSERT INTO public.combat_actions (
    id, encounter_id, character_id, node_id, ability_key,
    target_creature_id, target_character_id, client_seq
  ) VALUES (
    _id, v_encounter_id, _character_id, v_node_id, _ability_key,
    _target_creature_id, _target_character_id, COALESCE(_client_seq, 0)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- 3) set_ability_loadout: store defaults too (no more delete-on-default)
CREATE OR REPLACE FUNCTION public.set_ability_loadout(_character_id uuid, _role_id uuid, _ability_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _class text;
  _level int;
  _assignment record;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);

  PERFORM public.assert_loadout_swap_allowed(_character_id, _role_id);
  SELECT class, level INTO _class, _level FROM public.characters WHERE id = _character_id;

  SELECT ca.is_default, ca.unlock_level
    INTO _assignment
    FROM public.class_ability_assignments ca
    JOIN public.abilities a ON a.id = ca.ability_id
   WHERE ca.ability_id = _ability_id
     AND ca.role_id = _role_id
     AND ca.class_key = _class
     AND ca.status = 'active'
     AND a.status = 'active';

  IF _assignment IS NULL THEN
    RAISE EXCEPTION 'That technique is not available in this slot';
  END IF;
  IF _assignment.unlock_level > _level THEN
    RAISE EXCEPTION 'That technique unlocks at level %', _assignment.unlock_level;
  END IF;

  INSERT INTO public.character_ability_loadout (character_id, role_id, ability_id)
  VALUES (_character_id, _role_id, _ability_id)
  ON CONFLICT (character_id, role_id)
  DO UPDATE SET ability_id = EXCLUDED.ability_id, updated_at = now();
END;
$function$;

-- 4) clear_ability_loadout: materialize the class default instead of leaving the slot empty
CREATE OR REPLACE FUNCTION public.clear_ability_loadout(_character_id uuid, _role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _default_id uuid;
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  PERFORM public.assert_loadout_swap_allowed(_character_id, _role_id);

  SELECT ca.ability_id INTO _default_id
    FROM public.class_ability_assignments ca
    JOIN public.abilities a ON a.id = ca.ability_id
    JOIN public.characters c ON c.id = _character_id
   WHERE ca.role_id = _role_id
     AND ca.class_key = c.class
     AND ca.status = 'active'
     AND a.status = 'active'
     AND ca.is_default
   LIMIT 1;

  IF _default_id IS NULL THEN
    DELETE FROM public.character_ability_loadout
     WHERE character_id = _character_id AND role_id = _role_id;
    RETURN;
  END IF;

  INSERT INTO public.character_ability_loadout (character_id, role_id, ability_id)
  VALUES (_character_id, _role_id, _default_id)
  ON CONFLICT (character_id, role_id)
  DO UPDATE SET ability_id = EXCLUDED.ability_id, updated_at = now();
END;
$function$;

-- 5) Backfill: give every character explicit rows for unlocked default slots
DO $$
BEGIN
  PERFORM set_config('app.trusted_rpc', 'true', true);
  INSERT INTO public.character_ability_loadout (character_id, role_id, ability_id)
  SELECT c.id, ca.role_id, ca.ability_id
    FROM public.characters c
    JOIN public.class_ability_assignments ca
      ON ca.class_key = c.class AND ca.status = 'active' AND ca.is_default
    JOIN public.abilities a ON a.id = ca.ability_id AND a.status = 'active'
   WHERE ca.unlock_level <= c.level
  ON CONFLICT (character_id, role_id) DO NOTHING;
END $$;