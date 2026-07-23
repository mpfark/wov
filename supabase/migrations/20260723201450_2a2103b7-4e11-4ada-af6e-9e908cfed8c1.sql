
-- Stored Power for telegraphed boss casts
ALTER TABLE public.encounters
  ADD COLUMN IF NOT EXISTS stored_power int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stored_power_cap int,
  ADD COLUMN IF NOT EXISTS stored_power_source_id uuid;

-- Add: clamps to [0, stored_power_cap when not null]; writes an audit row.
CREATE OR REPLACE FUNCTION public.encounter_stored_power_add(
  _encounter_id uuid,
  _delta int,
  _reason text DEFAULT NULL,
  _source_id uuid DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new int;
  v_cap int;
  v_cur int;
BEGIN
  SELECT stored_power, stored_power_cap INTO v_cur, v_cap
  FROM public.encounters
  WHERE id = _encounter_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_new := GREATEST(0, v_cur + COALESCE(_delta, 0));
  IF v_cap IS NOT NULL THEN
    v_new := LEAST(v_new, v_cap);
  END IF;

  UPDATE public.encounters
     SET stored_power = v_new,
         stored_power_source_id = COALESCE(_source_id, stored_power_source_id),
         last_activity_at = now(),
         updated_at = now()
   WHERE id = _encounter_id;

  RETURN v_new;
END;
$$;

-- Consume Stored Power per mode; returns amount consumed for damage math.
-- modes: all | percent | fixed | preserve | reset | ignore
CREATE OR REPLACE FUNCTION public.encounter_stored_power_consume(
  _encounter_id uuid,
  _mode text,
  _pct numeric DEFAULT 100,
  _fixed int DEFAULT 0
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur int;
  v_used int := 0;
  v_new int;
BEGIN
  SELECT stored_power INTO v_cur
  FROM public.encounters
  WHERE id = _encounter_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  CASE COALESCE(_mode, 'all')
    WHEN 'all' THEN
      v_used := v_cur;
      v_new := 0;
    WHEN 'percent' THEN
      v_used := GREATEST(0, LEAST(v_cur, ROUND(v_cur * COALESCE(_pct, 100) / 100.0)::int));
      v_new := GREATEST(0, v_cur - v_used);
    WHEN 'fixed' THEN
      v_used := LEAST(v_cur, GREATEST(0, COALESCE(_fixed, 0)));
      v_new := GREATEST(0, v_cur - v_used);
    WHEN 'preserve' THEN
      v_used := v_cur;
      v_new := v_cur;
    WHEN 'reset' THEN
      v_used := 0;
      v_new := 0;
    ELSE -- ignore
      v_used := 0;
      v_new := v_cur;
  END CASE;

  UPDATE public.encounters
     SET stored_power = v_new,
         last_activity_at = now(),
         updated_at = now()
   WHERE id = _encounter_id;

  RETURN v_used;
END;
$$;

GRANT EXECUTE ON FUNCTION public.encounter_stored_power_add(uuid, int, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.encounter_stored_power_consume(uuid, text, numeric, int) TO authenticated, service_role;

-- Update resolve_cast to consume Stored Power and split primary/AoE damage.
-- Backwards compatible: legacy payloads (no stored_power block) fall through to the old amount path.
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
    -- Legacy path: single flat amount, applied to everyone (matches prior behaviour).
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
    RETURN;
  END IF;

  -- Primary target: prefer the encounter's tracked source, fall back to any eligible participant.
  SELECT stored_power_source_id INTO v_primary_target
  FROM public.encounters WHERE id = v_enc;

  IF v_primary_target IS NOT NULL THEN
    -- Ensure the primary target still qualifies (on node, alive, engaged).
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
        -- Legacy behaviour: everyone takes the same amount.
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

  -- Clear the source pointer if we consumed the pool.
  IF v_mode NOT IN ('preserve', 'ignore') THEN
    UPDATE public.encounters
       SET stored_power_source_id = NULL
     WHERE id = v_enc AND stored_power = 0;
  END IF;
END;
$function$;
