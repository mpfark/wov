
CREATE OR REPLACE FUNCTION public.encounter_stored_power_set_cap(
  _encounter_id uuid,
  _cap int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.encounters
     SET stored_power_cap = _cap,
         stored_power = CASE
           WHEN _cap IS NOT NULL AND stored_power > _cap THEN _cap
           ELSE stored_power
         END,
         updated_at = now()
   WHERE id = _encounter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_stored_power_set_cap(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_stored_power_set_cap(uuid, int) TO service_role;

-- Amend resolver: clear cap after consumption (so next cast starts fresh).
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
  v_lock_ms int;
  v_lock_until timestamptz;
  v_payload jsonb;
  v_already boolean;
  v_sp jsonb;
  v_mode text;
  v_pct numeric;
  v_fixed int;
  v_used int := 0;
  v_primary_share numeric;
  v_aoe_share numeric;
  v_base_primary int;
  v_base_aoe int;
  v_primary_dmg int;
  v_aoe_dmg int;
  v_primary_target uuid;
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

  v_lock_ms := GREATEST(COALESCE((v_payload->>'lock_ms')::int, 0), 0);
  IF v_lock_ms > 0 THEN
    v_lock_until := now() + make_interval(secs => v_lock_ms / 1000.0);
  ELSE
    v_lock_until := NULL;
  END IF;

  v_sp := v_payload -> 'stored_power';

  IF v_sp IS NOT NULL THEN
    v_mode := COALESCE(v_sp->>'consume_mode', 'all');
    v_pct := COALESCE((v_sp->>'consume_pct')::numeric, 100);
    v_fixed := COALESCE((v_sp->>'consume_amount')::int, 0);
    v_primary_share := COALESCE((v_sp->>'primary_share')::numeric, 1.0);
    v_aoe_share := COALESCE((v_sp->>'aoe_share')::numeric, 0.4);

    v_used := public.encounter_stored_power_consume(v_enc, v_mode, v_pct, v_fixed);
  ELSE
    v_mode := 'legacy';
    v_used := COALESCE((v_payload->>'amount')::int, 0);
    v_primary_share := 1.0;
    v_aoe_share := 1.0;
  END IF;

  v_base_primary := GREATEST(0, COALESCE((v_payload->>'base_amount')::int, 0));
  v_base_aoe := GREATEST(0, COALESCE((v_payload->>'base_aoe_amount')::int, 0));

  v_primary_dmg := GREATEST(0, v_base_primary + ROUND(v_used * v_primary_share)::int);
  v_aoe_dmg := GREATEST(0, v_base_aoe + ROUND(v_used * v_aoe_share)::int);

  IF v_primary_dmg = 0 AND v_aoe_dmg = 0 AND v_lock_until IS NULL THEN
    -- Still clear the cap so a subsequent cast starts fresh.
    IF v_mode NOT IN ('preserve', 'ignore') THEN
      UPDATE public.encounters
         SET stored_power_cap = NULL
       WHERE id = v_enc;
    END IF;
    RETURN;
  END IF;

  SELECT stored_power_source_id INTO v_primary_target
  FROM public.encounters WHERE id = v_enc;

  IF v_primary_target IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.encounter_participants ep
      JOIN public.characters c ON c.id = ep.character_id
      WHERE ep.encounter_id = v_enc
        AND ep.character_id = v_primary_target
        AND c.current_node_id = v_node
        AND c.hp > 0
    ) THEN
      v_primary_target := NULL;
    END IF;
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

    IF r.cid = v_primary_target THEN
      IF v_primary_dmg > 0 THEN
        RETURN QUERY
          SELECT r.cid, d.old_hp, d.new_hp, (d.old_hp - d.new_hp)::int, d.caused_death, v_lock_until
          FROM public.encounter_apply_character_damage(r.cid, v_primary_dmg, 'boss_cast', v_creature) d;
      ELSE
        RETURN QUERY SELECT r.cid, NULL::int, NULL::int, 0::int, false, v_lock_until;
      END IF;
    ELSE
      IF v_mode = 'legacy' THEN
        IF v_primary_dmg > 0 THEN
          RETURN QUERY
            SELECT r.cid, d.old_hp, d.new_hp, (d.old_hp - d.new_hp)::int, d.caused_death, v_lock_until
            FROM public.encounter_apply_character_damage(r.cid, v_primary_dmg, 'boss_cast', v_creature) d;
        ELSE
          RETURN QUERY SELECT r.cid, NULL::int, NULL::int, 0::int, false, v_lock_until;
        END IF;
      ELSE
        IF v_aoe_dmg > 0 THEN
          RETURN QUERY
            SELECT r.cid, d.old_hp, d.new_hp, (d.old_hp - d.new_hp)::int, d.caused_death, v_lock_until
            FROM public.encounter_apply_character_damage(r.cid, v_aoe_dmg, 'boss_cast', v_creature) d;
        ELSE
          RETURN QUERY SELECT r.cid, NULL::int, NULL::int, 0::int, false, v_lock_until;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF v_mode NOT IN ('preserve', 'ignore') THEN
    UPDATE public.encounters
       SET stored_power_source_id = NULL,
           stored_power_cap = NULL
     WHERE id = v_enc AND stored_power = 0;
  END IF;
END;
$function$;
