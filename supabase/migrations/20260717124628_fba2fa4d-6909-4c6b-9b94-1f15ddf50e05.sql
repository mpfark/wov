CREATE OR REPLACE FUNCTION public.encounter_apply_damage(_creature_id uuid, _amount integer, _source_character_id uuid, _source_kind text)
RETURNS TABLE(encounter_id uuid, new_hp integer, old_hp integer, caused_kill boolean, turned_aggressive boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc uuid;
  v_old_hp int;
  v_new_hp int;
  v_prev_aggr boolean;
  v_alive boolean;
  v_killed boolean := false;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'encounter_apply_damage: _amount must be >= 0 (got %)', _amount;
  END IF;

  -- 1. Attach on first hit (idempotent)
  v_enc := public.encounter_ensure_for_creature(_creature_id);

  -- 2. Serialize concurrent writers on this encounter
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  -- 3. Read-and-clamp delta write
  SELECT hp, is_aggressive, is_alive
    INTO v_old_hp, v_prev_aggr, v_alive
  FROM public.creatures
  WHERE id = _creature_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_alive THEN
    -- Creature already dead or missing; return a no-op row
    RETURN QUERY SELECT v_enc, 0, COALESCE(v_old_hp, 0), false, false;
    RETURN;
  END IF;

  v_new_hp := GREATEST(v_old_hp - _amount, 0);

  UPDATE public.creatures
     SET hp = v_new_hp,
         is_aggressive = true,
         last_damaged_at = CASE WHEN _amount > 0 THEN now() ELSE last_damaged_at END
   WHERE id = _creature_id;

  IF v_new_hp = 0 THEN
    UPDATE public.creatures
       SET is_alive = false,
           died_at = now(),
           is_aggressive = base_aggressive
     WHERE id = _creature_id;
    v_killed := true;

    -- Free the UNIQUE(creature_id) slot for respawn.
    DELETE FROM public.encounter_creatures WHERE creature_id = _creature_id;
  END IF;

  -- 4. Contribution ledger (coarse per-tick aggregation)
  IF _amount > 0 AND _source_character_id IS NOT NULL THEN
    INSERT INTO public.encounter_contributions (
      encounter_id, character_id, damage_dealt, healing_done, first_hit_at, last_hit_at
    ) VALUES (
      v_enc, _source_character_id, _amount, 0, now(), now()
    )
    ON CONFLICT ON CONSTRAINT encounter_contributions_pkey DO UPDATE
       SET damage_dealt = public.encounter_contributions.damage_dealt + EXCLUDED.damage_dealt,
           last_hit_at = now();
  END IF;

  RETURN QUERY SELECT v_enc, v_new_hp, v_old_hp, v_killed, (NOT v_prev_aggr);
END;
$function$;

REVOKE ALL ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.encounter_apply_damage(uuid, integer, uuid, text) TO service_role;