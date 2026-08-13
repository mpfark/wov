-- ─────────────────────────────────────────────────────────────
-- C3: single authoritative encounter identity, presence without
-- sessions, lease renewal, and removal of legacy authority.
-- ─────────────────────────────────────────────────────────────

-- 1. Merge duplicate live encounters per node so the invariant can be enforced.
DO $$
DECLARE
  r record;
  v_keeper uuid;
BEGIN
  FOR r IN
    SELECT node_id, encounter_key
    FROM public.encounters
    WHERE status IN ('active','idle')
    GROUP BY node_id, encounter_key
    HAVING count(*) > 1
  LOOP
    SELECT id INTO v_keeper
    FROM public.encounters
    WHERE node_id = r.node_id AND encounter_key = r.encounter_key
      AND status IN ('active','idle')
    ORDER BY started_at ASC, id ASC
    LIMIT 1;

    UPDATE public.encounter_participants ep
       SET encounter_id = v_keeper
     WHERE ep.encounter_id IN (
             SELECT id FROM public.encounters
             WHERE node_id = r.node_id AND encounter_key = r.encounter_key
               AND status IN ('active','idle') AND id <> v_keeper)
       AND NOT EXISTS (
             SELECT 1 FROM public.encounter_participants k
             WHERE k.encounter_id = v_keeper AND k.character_id = ep.character_id);

    UPDATE public.encounter_creatures ec
       SET encounter_id = v_keeper
     WHERE ec.encounter_id IN (
             SELECT id FROM public.encounters
             WHERE node_id = r.node_id AND encounter_key = r.encounter_key
               AND status IN ('active','idle') AND id <> v_keeper)
       AND NOT EXISTS (
             SELECT 1 FROM public.encounter_creatures k
             WHERE k.encounter_id = v_keeper AND k.creature_id = ec.creature_id);

    UPDATE public.encounter_engagements ee
       SET encounter_id = v_keeper
     WHERE ee.encounter_id IN (
             SELECT id FROM public.encounters
             WHERE node_id = r.node_id AND encounter_key = r.encounter_key
               AND status IN ('active','idle') AND id <> v_keeper)
       AND NOT EXISTS (
             SELECT 1 FROM public.encounter_engagements k
             WHERE k.encounter_id = v_keeper
               AND k.creature_id = ee.creature_id
               AND k.character_id = ee.character_id);

    -- Anything that could not be moved belongs to a row that is about to end.
    DELETE FROM public.encounter_participants
     WHERE encounter_id IN (
             SELECT id FROM public.encounters
             WHERE node_id = r.node_id AND encounter_key = r.encounter_key
               AND status IN ('active','idle') AND id <> v_keeper);
    DELETE FROM public.encounter_creatures
     WHERE encounter_id IN (
             SELECT id FROM public.encounters
             WHERE node_id = r.node_id AND encounter_key = r.encounter_key
               AND status IN ('active','idle') AND id <> v_keeper);
    DELETE FROM public.encounter_engagements
     WHERE encounter_id IN (
             SELECT id FROM public.encounters
             WHERE node_id = r.node_id AND encounter_key = r.encounter_key
               AND status IN ('active','idle') AND id <> v_keeper);

    UPDATE public.encounters
       SET status = 'ended', ended_at = now()
     WHERE node_id = r.node_id AND encounter_key = r.encounter_key
       AND status IN ('active','idle') AND id <> v_keeper;
  END LOOP;
END $$;

-- 2. The invariant itself: at most one non-terminal encounter per node/key.
DROP INDEX IF EXISTS public.encounters_active_key_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS encounters_live_key_uidx
  ON public.encounters (node_id, encounter_key)
  WHERE status IN ('active','idle');

-- 3. Explicit, deterministic encounter resolution for a node.
--    Documented rule: one node has exactly one authoritative encounter
--    (encounter_key = 'default'). Solo players and every party fighting at
--    that node share it. Non-overlapping fights at one node are still the
--    same encounter; separation is expressed by engagements, never by a
--    second encounter row.
CREATE OR REPLACE FUNCTION public.encounter_for_node(_node_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_status text;
BEGIN
  IF _node_id IS NULL THEN
    RAISE EXCEPTION 'encounter_for_node: node_id is required';
  END IF;

  LOOP
    SELECT id, status INTO v_id, v_status
    FROM public.encounters
    WHERE node_id = _node_id
      AND encounter_key = 'default'
      AND status IN ('active','idle');

    IF v_id IS NOT NULL THEN
      IF v_status = 'idle' THEN
        UPDATE public.encounters
           SET status = 'active', last_activity_at = now()
         WHERE id = v_id;
      END IF;
      RETURN v_id;
    END IF;

    BEGIN
      INSERT INTO public.encounters (node_id, encounter_key, status)
      VALUES (_node_id, 'default', 'active')
      RETURNING id INTO v_id;
      RETURN v_id;
    EXCEPTION WHEN unique_violation THEN
      v_id := NULL; -- another caller created it; loop and read that row
    END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.encounter_for_node(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_for_node(uuid) TO service_role;

-- 4. Safe intake: all runtime membership is created here, never in simulation.
CREATE OR REPLACE FUNCTION public.encounter_intake(
  _character_id uuid,
  _creature_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_node uuid;
  v_hp integer;
  v_enc uuid;
  v_party uuid;
  v_creatures uuid[];
BEGIN
  SELECT current_node_id, hp INTO v_node, v_hp
  FROM public.characters WHERE id = _character_id;

  IF v_node IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_node');
  END IF;
  IF COALESCE(v_hp, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'character_dead');
  END IF;

  v_enc := public.encounter_for_node(v_node);
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  INSERT INTO public.encounter_participants (encounter_id, character_id, last_action_at)
  VALUES (v_enc, _character_id, now())
  ON CONFLICT (character_id) DO UPDATE
     SET encounter_id = EXCLUDED.encounter_id,
         last_action_at = now();

  -- Every living creature at the node belongs to the node's encounter.
  INSERT INTO public.encounter_creatures (encounter_id, creature_id)
  SELECT v_enc, c.id
  FROM public.creatures c
  WHERE c.node_id = v_node AND c.is_alive = true
  ON CONFLICT (creature_id) DO UPDATE SET encounter_id = EXCLUDED.encounter_id;

  SELECT party_id INTO v_party
  FROM public.party_members
  WHERE character_id = _character_id AND status = 'active'
  LIMIT 1;

  -- Requested engagements, filtered to creatures that are really here.
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v_creatures
  FROM public.creatures c
  WHERE c.id = ANY(COALESCE(_creature_ids, '{}'::uuid[]))
    AND c.node_id = v_node
    AND c.is_alive = true;

  IF array_length(v_creatures, 1) > 0 THEN
    INSERT INTO public.encounter_engagements (encounter_id, creature_id, character_id, party_id_at_join)
    SELECT v_enc, cid, _character_id, v_party
    FROM unnest(v_creatures) AS cid
    ON CONFLICT (encounter_id, creature_id, character_id)
    DO UPDATE SET last_action_at = now();
  END IF;

  UPDATE public.encounters
     SET last_activity_at = now()
   WHERE id = v_enc;

  RETURN jsonb_build_object(
    'ok', true,
    'encounter_id', v_enc,
    'node_id', v_node,
    'engaged_creature_ids', COALESCE(v_creatures, '{}'::uuid[])
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.encounter_intake(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_intake(uuid, uuid[]) TO service_role;

-- 5. Legacy selection paths now route through the invariant resolver.
CREATE OR REPLACE FUNCTION public.encounter_ensure_for_character(_character_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_node_id uuid;
  v_encounter_id uuid;
BEGIN
  SELECT current_node_id INTO v_node_id
  FROM public.characters WHERE id = _character_id;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'character % has no current_node_id', _character_id;
  END IF;

  v_encounter_id := public.encounter_for_node(v_node_id);

  INSERT INTO public.encounter_participants (encounter_id, character_id, last_action_at)
  VALUES (v_encounter_id, _character_id, now())
  ON CONFLICT (character_id) DO UPDATE
     SET last_action_at = now(),
         encounter_id   = EXCLUDED.encounter_id;

  RETURN v_encounter_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.encounter_ensure_for_creature(_creature_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_node_id uuid;
  v_encounter_id uuid;
BEGIN
  SELECT node_id INTO v_node_id
  FROM public.creatures WHERE id = _creature_id;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'creature % has no node', _creature_id;
  END IF;

  v_encounter_id := public.encounter_for_node(v_node_id);

  INSERT INTO public.encounter_creatures (encounter_id, creature_id)
  VALUES (v_encounter_id, _creature_id)
  ON CONFLICT (creature_id) DO UPDATE SET encounter_id = EXCLUDED.encounter_id;

  RETURN v_encounter_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.encounter_reconcile(_node_id uuid)
RETURNS TABLE(encounter_id uuid, participants_purged integer, sessions_reset integer, status_after text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc uuid;
  v_purged int := 0;
  v_participants int;
  v_effects int;
  v_status text;
  v_last_activity timestamptz;
BEGIN
  SELECT id, status, last_activity_at
    INTO v_enc, v_status, v_last_activity
  FROM public.encounters
  WHERE node_id = _node_id
    AND encounter_key = 'default'
    AND status IN ('active','idle');

  IF v_enc IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 0, 0, NULL::text;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(v_enc));

  WITH del AS (
    DELETE FROM public.encounter_participants ep
    USING public.characters c
    WHERE ep.encounter_id = v_enc
      AND ep.character_id = c.id
      AND (c.current_node_id IS DISTINCT FROM _node_id OR c.hp <= 0)
    RETURNING ep.character_id
  )
  SELECT count(*)::int INTO v_purged FROM del;

  SELECT count(*)::int INTO v_participants
  FROM public.encounter_participants WHERE encounter_id = v_enc;

  SELECT count(*)::int INTO v_effects
  FROM public.active_effects WHERE node_id = _node_id;

  IF v_participants = 0 AND v_effects = 0 THEN
    IF v_status = 'idle' AND v_last_activity < now() - interval '30 minutes' THEN
      UPDATE public.encounters SET status = 'ended', ended_at = now() WHERE id = v_enc;
      v_status := 'ended';
    ELSIF v_status <> 'idle' THEN
      UPDATE public.encounters SET status = 'idle', last_activity_at = now() WHERE id = v_enc;
      v_status := 'idle';
    END IF;
  ELSIF v_status <> 'active' THEN
    UPDATE public.encounters SET status = 'active', last_activity_at = now() WHERE id = v_enc;
    v_status := 'active';
  END IF;

  RETURN QUERY SELECT v_enc, v_purged, 0, v_status;
END;
$function$;

-- 6. Claim: presence without combat_sessions, and resolver identity returned.
CREATE OR REPLACE FUNCTION public.claim_encounter_tick(
  _encounter_id uuid,
  _rate_ms integer,
  _lease_ms integer,
  _caller text,
  _supported_modes text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_mode text;
  v_grace_ms integer := 15000;
  v_live boolean;
  v_token uuid;
  v_resolver uuid;
  v_tick bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id;
  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_encounter');
  END IF;

  IF v_enc.tick_at = 0 THEN
    UPDATE public.encounters SET tick_at = v_now WHERE id = _encounter_id;
    v_enc.tick_at := v_now;
  END IF;

  -- Live presence is derived from encounter membership only. combat_sessions
  -- is presence/UI bookkeeping and carries no tick authority or cadence.
  SELECT EXISTS (
    SELECT 1
    FROM public.encounter_engagements e
    JOIN public.characters c ON c.id = e.character_id
    JOIN public.encounter_participants p
      ON p.encounter_id = e.encounter_id AND p.character_id = e.character_id
    WHERE e.encounter_id = _encounter_id
      AND c.hp > 0
      AND c.current_node_id = v_enc.node_id
      AND p.last_action_at > (to_timestamp((v_now - v_grace_ms) / 1000.0))
  ) INTO v_live;

  v_mode := CASE WHEN v_live THEN 'live' ELSE 'effects_only' END;

  IF v_enc.tick_state = 'resolving' AND v_enc.lease_until IS NOT NULL AND v_enc.lease_until > v_now THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_flight', 'mode', v_enc.tick_mode);
  END IF;

  IF v_enc.tick_state = 'resolving' THEN
    IF NOT (v_enc.tick_mode = ANY(_supported_modes)) THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_enc.tick_mode);
    END IF;
    v_token := gen_random_uuid();
    v_resolver := gen_random_uuid();
    UPDATE public.encounters
    SET claim_token = v_token,
        resolver_id = v_resolver,
        lease_until = v_now + _lease_ms,
        attempt = attempt + 1
    WHERE id = _encounter_id
    RETURNING resolving_tick, attempt INTO v_tick, v_enc.attempt;
    RETURN jsonb_build_object(
      'claimed', true, 'tick', v_tick, 'mode', v_enc.tick_mode,
      'claim_token', v_token, 'resolver_id', v_resolver,
      'lease_until', v_now + _lease_ms,
      'attempt', v_enc.attempt, 'reclaimed', true
    );
  END IF;

  IF NOT (v_mode = ANY(_supported_modes)) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'mode_refused', 'mode', v_mode);
  END IF;

  IF v_now - v_enc.tick_at < _rate_ms THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_due', 'mode', v_mode);
  END IF;

  v_token := gen_random_uuid();
  v_resolver := gen_random_uuid();
  UPDATE public.encounters
  SET tick_state = 'resolving',
      resolving_tick = tick_number + 1,
      tick_mode = v_mode,
      claim_token = v_token,
      resolver_id = v_resolver,
      lease_until = v_now + _lease_ms,
      attempt = 1
  WHERE id = _encounter_id
  RETURNING resolving_tick INTO v_tick;

  RETURN jsonb_build_object(
    'claimed', true, 'tick', v_tick, 'mode', v_mode,
    'claim_token', v_token, 'resolver_id', v_resolver,
    'lease_until', v_now + _lease_ms,
    'attempt', 1, 'reclaimed', false
  );
END;
$function$;

-- 7. Lease renewal, restricted to the exact current owner.
CREATE OR REPLACE FUNCTION public.renew_encounter_tick_lease(
  _encounter_id uuid,
  _tick bigint,
  _claim_token uuid,
  _resolver_id uuid,
  _extend_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_enc public.encounters;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  IF _extend_ms IS NULL OR _extend_ms <= 0 OR _extend_ms > 30000 THEN
    RETURN jsonb_build_object('renewed', false, 'reason', 'bad_extend_ms');
  END IF;

  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));
  SELECT * INTO v_enc FROM public.encounters WHERE id = _encounter_id FOR UPDATE;

  IF v_enc.id IS NULL THEN
    RETURN jsonb_build_object('renewed', false, 'reason', 'no_encounter');
  END IF;

  -- A stale resolver may never renew (or otherwise touch) a newer claim.
  IF v_enc.tick_state <> 'resolving'
     OR v_enc.resolving_tick IS DISTINCT FROM _tick
     OR v_enc.claim_token IS DISTINCT FROM _claim_token
     OR v_enc.resolver_id IS DISTINCT FROM _resolver_id THEN
    RETURN jsonb_build_object('renewed', false, 'reason', 'stale_claim');
  END IF;

  UPDATE public.encounters
     SET lease_until = v_now + _extend_ms
   WHERE id = _encounter_id;

  RETURN jsonb_build_object('renewed', true, 'tick', _tick, 'lease_until', v_now + _extend_ms);
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_encounter_tick_lease(uuid, bigint, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_encounter_tick_lease(uuid, bigint, uuid, uuid, integer) TO service_role;

-- 8. Legacy authority cannot execute any more.
DROP FUNCTION IF EXISTS public.commit_encounter_tick(uuid, bigint, uuid, uuid, integer, jsonb);
DROP FUNCTION IF EXISTS public.commit_encounter_tick(uuid, bigint, uuid, uuid, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.encounter_snapshot(uuid);
DROP FUNCTION IF EXISTS public.encounter_snapshot(uuid, integer);
DROP FUNCTION IF EXISTS public.combat_tick_owner();
DELETE FROM public.combat_config WHERE key = 'tick_owner';