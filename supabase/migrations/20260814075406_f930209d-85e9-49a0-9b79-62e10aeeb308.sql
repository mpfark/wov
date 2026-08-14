DO $mig$
DECLARE
  d text;
  old_cast text;
  new_cast text;
  old_decl text;
  old_env text;
BEGIN
  d := pg_get_functiondef(
    'public.commit_encounter_tick_v2(uuid,bigint,uuid,uuid,integer,integer,jsonb,jsonb,jsonb)'::regprocedure);

  old_decl := $r0$  v_session_skipped boolean := false;
  v_cap numeric;
$r0$;

  old_cast := $r1$  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'casts', '[]'::jsonb)) LOOP
    IF v_item->>'phase' = 'start' THEN
      INSERT INTO public.encounter_cast_events
        (encounter_id, creature_id, node_id, cast_key, ability_key, payload, started_at, expires_at)
      VALUES (_encounter_id, (v_item->>'creatureId')::uuid, v_enc.node_id,
              v_item->>'abilityKey', v_item->>'abilityKey', COALESCE(v_item->'payload', '{}'::jsonb),
              now(), to_timestamp(COALESCE((v_item->>'resolvesAtMs')::bigint, v_now) / 1000.0));
    ELSE
      UPDATE public.encounter_cast_events
      SET resolved_at = now(), payload = COALESCE(v_item->'payload', payload)
      WHERE encounter_id = _encounter_id
        AND creature_id = (v_item->>'creatureId')::uuid
        AND resolved_at IS NULL;
    END IF;
  END LOOP;
$r1$;

  new_cast := $r2$  -- Telegraphed casts. Start rows are created here (the committer owns the id);
  -- resolve/fizzle closes the exact row the resolver read back, so a duplicate
  -- or concurrent channel can never be closed by the wrong mutation. Every
  -- transition is echoed into v_casts, which the v3 batch publishes, so the
  -- client telegraph is driven only by committed state.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'casts', '[]'::jsonb)) LOOP
    v_cast_row := NULL;
    IF v_item->>'phase' = 'start' THEN
      INSERT INTO public.encounter_cast_events
        (encounter_id, creature_id, node_id, cast_key, ability_key, payload, started_at, expires_at)
      VALUES (_encounter_id, (v_item->>'creatureId')::uuid, v_enc.node_id,
              v_item->>'abilityKey', v_item->>'abilityKey', COALESCE(v_item->'payload', '{}'::jsonb),
              now(), to_timestamp(COALESCE((v_item->>'resolvesAtMs')::bigint, v_now) / 1000.0))
      RETURNING id INTO v_cast_row;
    ELSE
      UPDATE public.encounter_cast_events
      SET resolved_at = now(), payload = COALESCE(v_item->'payload', payload)
      WHERE encounter_id = _encounter_id
        AND resolved_at IS NULL
        AND creature_id = (v_item->>'creatureId')::uuid
        AND (
          v_item->>'castEventId' IS NULL
          OR v_item->>'castEventId' NOT SIMILAR TO
             '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
          OR id = (v_item->>'castEventId')::uuid
        )
      RETURNING id INTO v_cast_row;
    END IF;
    v_casts := v_casts || jsonb_build_array(
      (v_item - 'payload') || jsonb_build_object(
        'castEventId', COALESCE(v_cast_row::text, v_item->>'castEventId'),
        'label', COALESCE(v_item->'payload'->>'label', v_item->>'castKey'),
        'castMs', COALESCE(v_item->'payload'->'cast_ms', to_jsonb(0)),
        'storedPowerCap', COALESCE(v_item->'payload'->'stored_power'->'cap', to_jsonb(0)),
        'targets', COALESCE(v_item->'payload'->'targets', '[]'::jsonb)));
  END LOOP;
$r2$;

  old_env := $r3$    'effectDeleteTargetIds', COALESCE(_proposed->'effectDeleteTargetIds', '[]'::jsonb),$r3$;

  IF position(old_decl in d) = 0 THEN RAISE EXCEPTION 'decl anchor not found'; END IF;
  IF position(old_cast in d) = 0 THEN RAISE EXCEPTION 'cast anchor not found'; END IF;
  IF position(old_env in d) = 0 THEN RAISE EXCEPTION 'envelope anchor not found'; END IF;

  d := replace(d, old_decl, old_decl || $r4$  v_cast_row uuid;
  v_casts jsonb := '[]'::jsonb;
$r4$);
  d := replace(d, old_cast, new_cast);
  d := replace(d, old_env, old_env || $r5$
    'casts', v_casts,
    'storedPower', COALESCE(_proposed->'storedPower', '[]'::jsonb),$r5$);

  EXECUTE d;
END
$mig$;