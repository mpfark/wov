CREATE OR REPLACE FUNCTION public.leave_encounter_engagements(_character_id uuid, _creature_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nodes uuid[];
  v_node uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'not your character';
  END IF;

  -- Departure hand-off must be scoped to the encounter the character was
  -- ENGAGED in, never to `characters.current_node_id`: by the time the client
  -- disengages after a move, the character already stands on the new node, so
  -- reading the current node armed the wrong (usually empty) node and stranded
  -- the effects-only work on the node just left.
  WITH del AS (
    DELETE FROM public.encounter_engagements
    WHERE character_id = _character_id
      AND (_creature_id IS NULL OR creature_id = _creature_id)
    RETURNING encounter_id
  )
  SELECT COALESCE(array_agg(DISTINCT e.node_id), '{}')
    INTO v_nodes
  FROM del JOIN public.encounters e ON e.id = del.encounter_id;

  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'disengaged'
  WHERE character_id = _character_id
    AND status = 'pending'
    AND (_creature_id IS NULL OR target_creature_id = _creature_id);

  FOREACH v_node IN ARRAY COALESCE(v_nodes, '{}') LOOP
    BEGIN
      PERFORM public.arm_effects_catchup_for_node(v_node);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Fallback: if the character was not engaged (or the rows were already gone)
  -- still consider the node it currently stands on, preserving prior behaviour.
  IF COALESCE(array_length(v_nodes, 1), 0) = 0 THEN
    SELECT current_node_id INTO v_node FROM public.characters WHERE id = _character_id;
    BEGIN
      PERFORM public.arm_effects_catchup_for_node(v_node);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
END;
$function$;