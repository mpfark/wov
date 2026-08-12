-- B2 follow-up: build the effect upsert with explicit defaults instead of
-- jsonb_populate_recordset, which produced NULLs for omitted NOT NULL columns
-- (id, created_at, stacks, tick_rate_ms).
CREATE OR REPLACE FUNCTION public.commit_encounter_tick(
  _encounter_id uuid,
  _tick bigint,
  _claim_token uuid,
  _batch_id uuid,
  _rate_ms integer,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_enc public.encounters;
  v_consumed uuid[];
  v_rejected jsonb;
  v_item jsonb;
  v_state jsonb;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_sets text;
  v_cid uuid;
  v_patch jsonb;
  v_num numeric;
  v_ids uuid[];
  v_session jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'no_encounter');
  END IF;

  IF v_enc.tick_number >= _tick THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'already_committed', 'tick_number', v_enc.tick_number);
  END IF;

  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'stale_claim');
  END IF;

  v_state := _payload->'state';

  -- ───────── Character patches (whitelisted by real column names) ─────────
  IF v_state ? 'characters' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_state->'characters') LOOP
      v_cid := (v_item->>'id')::uuid;
      IF v_cid IS NULL THEN CONTINUE; END IF;

      v_patch := COALESCE(v_item->'patch', '{}'::jsonb);
      IF jsonb_typeof(v_patch) = 'object' AND v_patch <> '{}'::jsonb THEN
        SELECT string_agg(
                 format('%I = ($1->>%L)::%s', a.attname, k.key,
                        format_type(a.atttypid, a.atttypmod)), ', ')
        INTO v_sets
        FROM jsonb_object_keys(v_patch) AS k(key)
        JOIN pg_attribute a
          ON a.attrelid = 'public.characters'::regclass
         AND a.attname = k.key
         AND a.attnum > 0
         AND NOT a.attisdropped;

        IF v_sets IS NOT NULL THEN
          EXECUTE format('UPDATE public.characters SET %s WHERE id = %L', v_sets, v_cid)
          USING v_patch;
        END IF;
      END IF;

      v_num := COALESCE((v_item->>'hp_delta')::numeric, 0);
      IF v_num < 0 THEN
        PERFORM public.encounter_apply_character_damage(v_cid, (-v_num)::integer, 'combat-tick', NULL);
      ELSIF v_num > 0 THEN
        PERFORM public.encounter_apply_character_heal(v_cid, v_num::integer, 'combat-tick');
      END IF;

      v_num := COALESCE((v_item->>'cp_delta')::numeric, 0);
      IF v_num <> 0 THEN
        PERFORM public.encounter_apply_character_resource(v_cid, 'cp', v_num::integer, 'combat-tick');
      END IF;

      v_num := COALESCE((v_item->>'mp_delta')::numeric, 0);
      IF v_num <> 0 THEN
        PERFORM public.encounter_apply_character_resource(v_cid, 'mp', v_num::integer, 'combat-tick');
      END IF;
    END LOOP;
  END IF;

  -- ───────── Materials / gems / salvage ─────────
  IF v_state ? 'materials' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_state->'materials') LOOP
      IF (v_item->>'character_id') IS NULL OR (v_item->>'key') IS NULL THEN CONTINUE; END IF;
      PERFORM public.add_material(
        (v_item->>'character_id')::uuid,
        v_item->>'key',
        COALESCE((v_item->>'delta')::integer, 0)
      );
    END LOOP;
  END IF;

  -- ───────── Assassin contract completions ─────────
  IF v_state ? 'contracts' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_state->'contracts') LOOP
      IF (v_item->>'character_id') IS NULL THEN CONTINUE; END IF;
      PERFORM public.apply_contract_complete(
        (v_item->>'character_id')::uuid,
        COALESCE((v_item->>'new_count')::integer, 0)
      );
    END LOOP;
  END IF;

  -- ───────── Class bond gains ─────────
  IF v_state ? 'bond_kills' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_state->'bond_kills') LOOP
      IF (v_item->>'character_id') IS NULL THEN CONTINUE; END IF;
      PERFORM public.award_class_bond_for_kill(
        (v_item->>'character_id')::uuid,
        COALESCE((v_item->>'creature_level')::integer, 1),
        COALESCE((v_item->>'is_boss')::boolean, false)
      );
    END LOOP;
  END IF;

  -- ───────── Effects: delete expired / dead targets, then upsert survivors ─────────
  IF v_state ? 'effects_delete_ids' THEN
    SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_ids
    FROM jsonb_array_elements_text(v_state->'effects_delete_ids') AS x;
    IF array_length(v_ids, 1) > 0 THEN
      DELETE FROM public.active_effects WHERE id = ANY(v_ids);
    END IF;
  END IF;

  IF v_state ? 'effects_delete_targets' THEN
    SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_ids
    FROM jsonb_array_elements_text(v_state->'effects_delete_targets') AS x;
    IF array_length(v_ids, 1) > 0 THEN
      DELETE FROM public.active_effects WHERE target_id = ANY(v_ids);
    END IF;
  END IF;

  IF (v_state->>'item_buff_expire_before') IS NOT NULL THEN
    DELETE FROM public.active_effects
    WHERE effect_type LIKE 'item_buff:%'
      AND expires_at <= (v_state->>'item_buff_expire_before')::bigint;
  END IF;

  IF v_state ? 'effects_upsert' THEN
    INSERT INTO public.active_effects AS ae (
      id, node_id, target_id, source_id, session_id, effect_type, stacks,
      damage_per_tick, next_tick_at, expires_at, tick_rate_ms, created_at,
      source_ability_key, started_at
    )
    SELECT
      COALESCE((e->>'id')::uuid, gen_random_uuid()),
      (e->>'node_id')::uuid,
      (e->>'target_id')::uuid,
      (e->>'source_id')::uuid,
      (e->>'session_id')::uuid,
      e->>'effect_type',
      COALESCE((e->>'stacks')::integer, 1),
      COALESCE((e->>'damage_per_tick')::integer, 0),
      (e->>'next_tick_at')::bigint,
      COALESCE((e->>'expires_at')::bigint, 0),
      COALESCE((e->>'tick_rate_ms')::integer, 2000),
      COALESCE((e->>'created_at')::timestamptz, now()),
      e->>'source_ability_key',
      (e->>'started_at')::bigint
    FROM jsonb_array_elements(v_state->'effects_upsert') AS e
    WHERE (e->>'node_id') IS NOT NULL
      AND (e->>'target_id') IS NOT NULL
      AND (e->>'source_id') IS NOT NULL
      AND (e->>'effect_type') IS NOT NULL
    ON CONFLICT (source_id, target_id, effect_type) DO UPDATE
      SET stacks = EXCLUDED.stacks,
          damage_per_tick = EXCLUDED.damage_per_tick,
          expires_at = EXCLUDED.expires_at,
          next_tick_at = EXCLUDED.next_tick_at,
          tick_rate_ms = EXCLUDED.tick_rate_ms,
          node_id = EXCLUDED.node_id;
  END IF;

  -- ───────── Engagement bookkeeping ─────────
  IF v_state ? 'engagements_purge_creature_ids' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_state->'engagements_purge_creature_ids') LOOP
      PERFORM public.purge_creature_engagements((v_item#>>'{}')::uuid);
    END LOOP;
  END IF;

  IF v_state ? 'engagements_join' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_state->'engagements_join') LOOP
      IF (v_item->>'character_id') IS NULL OR (v_item->>'creature_id') IS NULL THEN CONTINUE; END IF;
      PERFORM public.join_encounter_engagement(
        (v_item->>'character_id')::uuid,
        (v_item->>'creature_id')::uuid
      );
    END LOOP;
  END IF;

  -- ───────── Combat session close / advance ─────────
  v_session := v_state->'session';
  IF v_session IS NOT NULL AND (v_session->>'id') IS NOT NULL THEN
    IF COALESCE((v_session->>'ended')::boolean, false) THEN
      DELETE FROM public.combat_sessions WHERE id = (v_session->>'id')::uuid;
    ELSE
      UPDATE public.combat_sessions
      SET last_tick_at = COALESCE((v_session->>'last_tick_at')::bigint, last_tick_at),
          engaged_creature_ids = COALESCE(
            (SELECT array_agg(x::uuid)
               FROM jsonb_array_elements_text(v_session->'engaged_creature_ids') AS x),
            engaged_creature_ids),
          member_buffs = COALESCE(v_session->'member_buffs', member_buffs),
          node_id = COALESCE((v_session->>'node_id')::uuid, node_id),
          recent_member_ids = COALESCE(v_session->'recent_member_ids', recent_member_ids)
      WHERE id = (v_session->>'id')::uuid;
    END IF;
  END IF;

  -- ───────── Durable intent retirement ─────────
  SELECT COALESCE(array_agg((x)::uuid), '{}')
  INTO v_consumed
  FROM jsonb_array_elements_text(COALESCE(_payload->'consumed_action_ids', '[]'::jsonb)) AS x;

  IF array_length(v_consumed, 1) > 0 THEN
    UPDATE public.combat_actions
    SET status = 'consumed', consumed_tick = _tick
    WHERE id = ANY(v_consumed) AND status = 'pending';
  END IF;

  v_rejected := COALESCE(_payload->'rejected_actions', '[]'::jsonb);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_rejected) LOOP
    UPDATE public.combat_actions
    SET status = 'rejected',
        consumed_tick = _tick,
        reject_reason = COALESCE(v_item->>'reason', 'rejected')
    WHERE id = (v_item->>'id')::uuid AND status = 'pending';
  END LOOP;

  -- ───────── Result batch ─────────
  INSERT INTO public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
  VALUES (_encounter_id, _tick, _batch_id, COALESCE(_payload->'batch', '{}'::jsonb))
  ON CONFLICT (encounter_id, tick_number) DO NOTHING;

  DELETE FROM public.encounter_tick_batches
  WHERE encounter_id = _encounter_id AND created_at < now() - interval '60 seconds';

  -- ───────── Cursor anchored to the ACTUAL commit time ─────────
  UPDATE public.encounters
  SET tick_number = _tick,
      tick_at = v_now_ms,
      tick_state = 'idle',
      resolving_tick = NULL,
      claim_token = NULL,
      resolver_id = NULL,
      lease_until = NULL,
      attempt = 0,
      last_activity_at = now()
  WHERE id = _encounter_id;

  RETURN jsonb_build_object(
    'committed', true, 'tick', _tick, 'batch_id', _batch_id,
    'committed_at', v_now_ms, 'state_applied', v_state IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_encounter_tick(uuid, bigint, uuid, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_encounter_tick(uuid, bigint, uuid, uuid, integer, jsonb) TO service_role;