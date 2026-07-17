
-- M6: Telegraphed Boss Casts — extend encounter_cast_events for in-flight casts.

ALTER TABLE public.encounter_cast_events
  ADD COLUMN IF NOT EXISTS creature_id uuid REFERENCES public.creatures(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS node_id uuid REFERENCES public.nodes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- resolved_at was NOT NULL with default now(); relax so we can insert in-flight casts.
ALTER TABLE public.encounter_cast_events
  ALTER COLUMN resolved_at DROP NOT NULL,
  ALTER COLUMN resolved_at DROP DEFAULT;

-- Index for the node-scoped "active casts" query used by combat-tick + client hydration.
CREATE INDEX IF NOT EXISTS encounter_cast_events_active_idx
  ON public.encounter_cast_events (node_id, expires_at)
  WHERE resolved_at IS NULL;

-- ── encounter_boss_start_cast ─────────────────────────────────────
-- Inserts an in-flight cast row. Idempotent-ish: refuses to start a new cast
-- if the same creature already has an unresolved cast within the encounter.
CREATE OR REPLACE FUNCTION public.encounter_boss_start_cast(
  _encounter_id uuid,
  _creature_id uuid,
  _node_id uuid,
  _cast_key text,
  _ability_key text,
  _cast_ms int,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  cast_event_id uuid,
  started_at timestamptz,
  expires_at timestamptz,
  skipped boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_started timestamptz := now();
  v_expires timestamptz;
  v_exists uuid;
BEGIN
  IF _cast_ms IS NULL OR _cast_ms < 100 OR _cast_ms > 60000 THEN
    RAISE EXCEPTION 'encounter_boss_start_cast: _cast_ms out of range (got %)', _cast_ms;
  END IF;

  PERFORM pg_advisory_xact_lock(public.encounter_lock_key(_encounter_id));

  SELECT id INTO v_exists
  FROM public.encounter_cast_events
  WHERE encounter_id = _encounter_id
    AND creature_id = _creature_id
    AND resolved_at IS NULL
  LIMIT 1;

  IF v_exists IS NOT NULL THEN
    RETURN QUERY
      SELECT ce.id, ce.started_at, ce.expires_at, true
      FROM public.encounter_cast_events ce WHERE ce.id = v_exists;
    RETURN;
  END IF;

  v_expires := v_started + make_interval(secs => _cast_ms / 1000.0);

  INSERT INTO public.encounter_cast_events
    (encounter_id, creature_id, node_id, cast_key, ability_key,
     started_at, expires_at, resolved_at, payload)
  VALUES
    (_encounter_id, _creature_id, _node_id, _cast_key, _ability_key,
     v_started, v_expires, NULL, COALESCE(_payload, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_started, v_expires, false;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_boss_start_cast(uuid,uuid,uuid,text,text,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_boss_start_cast(uuid,uuid,uuid,text,text,int,jsonb) TO service_role;

-- ── encounter_boss_resolve_cast ───────────────────────────────────
-- Marks the cast as resolved and applies its effect to every character still
-- engaged at the boss's node. Idempotent — a second call returns no hits.
CREATE OR REPLACE FUNCTION public.encounter_boss_resolve_cast(
  _cast_event_id uuid
)
RETURNS TABLE (
  character_id uuid,
  old_hp int,
  new_hp int,
  amount int,
  caused_death boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enc uuid;
  v_node uuid;
  v_creature uuid;
  v_amount int;
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
  IF v_amount <= 0 THEN
    RETURN;
  END IF;

  -- Apply to every participant still engaged AND still at the node.
  FOR r IN
    SELECT ep.character_id AS cid
    FROM public.encounter_participants ep
    JOIN public.characters c ON c.id = ep.character_id
    WHERE ep.encounter_id = v_enc
      AND ep.left_at IS NULL
      AND c.current_node_id = v_node
      AND c.hp > 0
  LOOP
    RETURN QUERY
      SELECT r.cid,
             d.old_hp,
             d.new_hp,
             (d.old_hp - d.new_hp)::int,
             d.caused_death
      FROM public.encounter_apply_character_damage(r.cid, v_amount, 'boss_cast', v_creature) d;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_boss_resolve_cast(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_boss_resolve_cast(uuid) TO service_role;
