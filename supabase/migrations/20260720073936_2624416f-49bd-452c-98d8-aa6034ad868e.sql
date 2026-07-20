CREATE OR REPLACE FUNCTION public.encounter_boss_resolve_cast(_cast_event_id uuid)
RETURNS TABLE(character_id uuid, old_hp integer, new_hp integer, amount integer, caused_death boolean, locked_until timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc uuid;
  v_node uuid;
  v_creature uuid;
  v_amount int;
  v_lock_ms int;
  v_lock_until timestamptz;
  v_payload jsonb;
  v_already boolean;
  r record;
BEGIN
  SELECT encounter_id, node_id, creature_id, payload, resolved_at IS NOT NULL
    INTO v_enc, v_node, v_creature, v_payload, v_already
  FROM public.encounter_cast_events
  WHERE id = _cast_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_already THEN
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  UPDATE public.encounter_cast_events
     SET resolved_at = now()
   WHERE id = _cast_event_id;

  v_amount := COALESCE((v_payload->>'amount')::int, 0);
  v_lock_ms := GREATEST(COALESCE((v_payload->>'lock_ms')::int, 0), 0);
  IF v_lock_ms > 0 THEN
    v_lock_until := now() + make_interval(secs => v_lock_ms / 1000.0);
  ELSE
    v_lock_until := NULL;
  END IF;

  IF v_amount <= 0 AND v_lock_until IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT ep.character_id AS cid
    FROM public.encounter_participants ep
    JOIN public.characters c ON c.id = ep.character_id
    WHERE ep.encounter_id = v_enc
      AND c.current_node_id = v_node
      AND c.hp > 0
  LOOP
    IF v_lock_until IS NOT NULL THEN
      UPDATE public.characters
         SET movement_locked_until = GREATEST(COALESCE(movement_locked_until, v_lock_until), v_lock_until)
       WHERE id = r.cid;
    END IF;

    IF v_amount > 0 THEN
      RETURN QUERY
        SELECT r.cid,
               d.old_hp,
               d.new_hp,
               (d.old_hp - d.new_hp)::int,
               d.caused_death,
               v_lock_until
        FROM public.encounter_apply_character_damage(r.cid, v_amount, 'boss_cast', v_creature) d;
    ELSE
      RETURN QUERY
        SELECT r.cid, NULL::int, NULL::int, 0::int, false, v_lock_until;
    END IF;
  END LOOP;
END;
$function$;

-- Clean up stranded unresolved casts so they don't retro-resolve on next tick.
UPDATE public.encounter_cast_events
   SET resolved_at = now()
 WHERE resolved_at IS NULL;
