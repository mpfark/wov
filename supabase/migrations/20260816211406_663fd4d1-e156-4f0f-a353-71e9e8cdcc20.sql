DO $mig$
DECLARE
  src text;
  a text;
  b text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'commit_encounter_tick_v2';
  IF src IS NULL THEN
    RAISE EXCEPTION 'commit_encounter_tick_v2 not found';
  END IF;

  -- 1. new locals
  a := E'  v_casts jsonb := \'[]\'::jsonb;';
  b := a || E'\n  v_alive jsonb := \'[]\'::jsonb;\n  v_alive_engaged jsonb := \'[]\'::jsonb;\n  v_ended boolean := false;';
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'anchor 1 (declare) not found'; END IF;
  src := replace(src, a, b);

  -- 2. creature death semantics: killed = false never revives
  a := $a$  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'creatures', '[]'::jsonb)) LOOP
    UPDATE public.creatures
    SET hp = (v_item->>'hpAfter')::integer,
        is_alive = NOT COALESCE((v_item->>'killed')::boolean, false),
        died_at = CASE WHEN COALESCE((v_item->>'killed')::boolean, false) THEN now() ELSE died_at END,
        rewards_awarded_at = CASE WHEN COALESCE((v_item->>'killed')::boolean, false)
                                  THEN now() ELSE rewards_awarded_at END,
        last_damaged_at = now()
    WHERE id = (v_item->>'creatureId')::uuid;
  END LOOP;$a$;
  b := $b$  -- Death is one-way for a given spawn generation. A full-roster row with
  -- killed = false means "this tick did not kill it", never "revive it"; an
  -- already dead row is left untouched. Only the respawn lifecycle may set
  -- is_alive back to true, and only that transition advances spawn_seq
  -- (trigger bump_creature_spawn_seq). A stale spawn_seq is already refused,
  -- with zero writes, by the pre-mutation validation above.
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'creatures', '[]'::jsonb)) LOOP
    IF COALESCE((v_item->>'killed')::boolean, false) THEN
      UPDATE public.creatures
      SET hp = 0,
          is_alive = false,
          died_at = COALESCE(died_at, now()),
          rewards_awarded_at = COALESCE(rewards_awarded_at, now()),
          last_damaged_at = now()
      WHERE id = (v_item->>'creatureId')::uuid
        AND is_alive = true
        AND spawn_seq = COALESCE((v_item->>'spawnSeq')::integer, spawn_seq);
    ELSE
      UPDATE public.creatures
      SET hp = (v_item->>'hpAfter')::integer,
          last_damaged_at = now()
      WHERE id = (v_item->>'creatureId')::uuid
        AND is_alive = true
        AND spawn_seq = COALESCE((v_item->>'spawnSeq')::integer, spawn_seq);
    END IF;
  END LOOP;$b$;
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'anchor 2 (creature loop) not found'; END IF;
  src := replace(src, a, b);

  -- 3. corpse purge + authoritative living roster + termination
  a := $a$  UPDATE public.encounters
  SET tick_number = _tick,$a$;
  b := $b$  -- Corpses leave every engagement representation, including creatures that
  -- died on an earlier tick, so no dead row can sustain the tick loop.
  DELETE FROM public.encounter_engagements ee
  USING public.creatures cr
  WHERE ee.encounter_id = _encounter_id
    AND cr.id = ee.creature_id
    AND (cr.is_alive = false OR cr.hp <= 0);

  -- Authoritative living roster, read after every creature write of this tick.
  SELECT COALESCE(jsonb_agg(to_jsonb(cr.id::text) ORDER BY cr.id::text), '[]'::jsonb)
    INTO v_alive
  FROM public.encounter_creatures ec
  JOIN public.creatures cr ON cr.id = ec.creature_id
  WHERE ec.encounter_id = _encounter_id
    AND cr.is_alive = true
    AND cr.hp > 0;

  SELECT COALESCE(jsonb_agg(DISTINCT to_jsonb(ee.creature_id::text)), '[]'::jsonb)
    INTO v_alive_engaged
  FROM public.encounter_engagements ee
  WHERE ee.encounter_id = _encounter_id
    AND v_alive ? ee.creature_id::text;

  v_ended := jsonb_array_length(v_alive_engaged) = 0;

  -- Session presence follows the committed living roster, not the proposal.
  IF v_session IS NOT NULL AND (v_session->>'sessionId') IS NOT NULL AND NOT v_session_skipped THEN
    IF v_ended THEN
      DELETE FROM public.combat_sessions WHERE id = (v_session->>'sessionId')::uuid;
    ELSE
      UPDATE public.combat_sessions
      SET engaged_creature_ids = (
            SELECT array_agg(x::uuid)
            FROM jsonb_array_elements_text(v_alive_engaged) AS x)
      WHERE id = (v_session->>'sessionId')::uuid;
    END IF;
  END IF;

  -- No living engaged creature left: end through the normal authoritative path.
  IF v_ended THEN
    PERFORM public.encounter_end(_encounter_id);
  END IF;

  UPDATE public.encounters
  SET tick_number = _tick,$b$;
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'anchor 3 (cursor advance) not found'; END IF;
  src := replace(src, a, b);

  -- 4. publish the committed terminal state on the batch session object
  a := $a$    'session', COALESCE(_proposed->'session', jsonb_build_object('ended', false, 'nextDueAtMs', 0))));$a$;
  b := $b$    'session', COALESCE(_proposed->'session', jsonb_build_object('ended', false, 'nextDueAtMs', 0))
                || jsonb_build_object('ended', v_ended,
                                      'engagedCreatureIds', v_alive_engaged,
                                      'aliveCreatureIds', v_alive)));$b$;
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'anchor 4 (batch session) not found'; END IF;
  src := replace(src, a, b);

  -- 5. same terminal state on the RPC result
  a := $a$    'applied', jsonb_build_object('session_skipped', v_session_skipped));$a$;
  b := $b$    'ended', v_ended, 'engaged_creature_ids', v_alive_engaged,
    'alive_creature_ids', v_alive,
    'applied', jsonb_build_object('session_skipped', v_session_skipped));$b$;
  IF position(a in src) = 0 THEN RAISE EXCEPTION 'anchor 5 (result) not found'; END IF;
  src := replace(src, a, b);

  EXECUTE src;
END
$mig$;