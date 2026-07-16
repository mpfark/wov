
-- ============================================================================
-- M1: Encounter Architecture Foundation (additive, no behavior change)
-- ============================================================================

CREATE TABLE public.encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id uuid NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
  encounter_key text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'active',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encounters_status_chk CHECK (status IN ('active','ended'))
);

CREATE UNIQUE INDEX encounters_active_key_uidx
  ON public.encounters (node_id, encounter_key)
  WHERE status = 'active';

CREATE INDEX encounters_node_idx ON public.encounters (node_id);
CREATE INDEX encounters_status_idx ON public.encounters (status);

GRANT SELECT ON public.encounters TO authenticated;
GRANT ALL ON public.encounters TO service_role;
ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read encounters"
  ON public.encounters FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------

CREATE TABLE public.encounter_creatures (
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (encounter_id, creature_id),
  UNIQUE (creature_id)
);

CREATE INDEX encounter_creatures_encounter_idx ON public.encounter_creatures (encounter_id);

GRANT SELECT ON public.encounter_creatures TO authenticated;
GRANT ALL ON public.encounter_creatures TO service_role;
ALTER TABLE public.encounter_creatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read encounter_creatures"
  ON public.encounter_creatures FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------

CREATE TABLE public.encounter_participants (
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_action_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (encounter_id, character_id),
  UNIQUE (character_id)
);

CREATE INDEX encounter_participants_encounter_idx ON public.encounter_participants (encounter_id);

GRANT SELECT ON public.encounter_participants TO authenticated;
GRANT ALL ON public.encounter_participants TO service_role;
ALTER TABLE public.encounter_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read encounter_participants"
  ON public.encounter_participants FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------

CREATE TABLE public.encounter_contributions (
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  damage_dealt integer NOT NULL DEFAULT 0,
  healing_done integer NOT NULL DEFAULT 0,
  first_hit_at timestamptz,
  last_hit_at timestamptz,
  PRIMARY KEY (encounter_id, character_id)
);

CREATE INDEX encounter_contributions_encounter_idx ON public.encounter_contributions (encounter_id);

GRANT SELECT ON public.encounter_contributions TO authenticated;
GRANT ALL ON public.encounter_contributions TO service_role;
ALTER TABLE public.encounter_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read encounter_contributions"
  ON public.encounter_contributions FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------

CREATE TABLE public.encounter_cast_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  cast_key text NOT NULL,
  ability_key text,
  started_at timestamptz,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX encounter_cast_events_encounter_idx
  ON public.encounter_cast_events (encounter_id, resolved_at DESC);

GRANT SELECT ON public.encounter_cast_events TO authenticated;
GRANT ALL ON public.encounter_cast_events TO service_role;
ALTER TABLE public.encounter_cast_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read encounter_cast_events"
  ON public.encounter_cast_events FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- updated_at trigger for encounters (project's shared trigger fn is update_updated_at)
-- ----------------------------------------------------------------------------

CREATE TRIGGER encounters_set_updated_at
  BEFORE UPDATE ON public.encounters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- Helper: derive a stable 64-bit advisory-lock key from an encounter UUID
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.encounter_lock_key(_encounter_id uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (('x' || substr(replace(_encounter_id::text, '-', ''), 1, 16))::bit(64))::bigint
$$;

-- ----------------------------------------------------------------------------
-- Stubs for later milestones (no game code calls them yet)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.encounter_ensure_for_creature(_creature_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node_id uuid;
  v_encounter_id uuid;
BEGIN
  SELECT encounter_id INTO v_encounter_id
  FROM public.encounter_creatures
  WHERE creature_id = _creature_id;

  IF v_encounter_id IS NOT NULL THEN
    RETURN v_encounter_id;
  END IF;

  SELECT node_id INTO v_node_id
  FROM public.creatures
  WHERE id = _creature_id;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'creature % has no node', _creature_id;
  END IF;

  SELECT id INTO v_encounter_id
  FROM public.encounters
  WHERE node_id = v_node_id AND encounter_key = 'default' AND status = 'active'
  LIMIT 1;

  IF v_encounter_id IS NULL THEN
    INSERT INTO public.encounters (node_id, encounter_key, status)
    VALUES (v_node_id, 'default', 'active')
    RETURNING id INTO v_encounter_id;
  END IF;

  INSERT INTO public.encounter_creatures (encounter_id, creature_id)
  VALUES (v_encounter_id, _creature_id)
  ON CONFLICT (creature_id) DO NOTHING;

  RETURN v_encounter_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_ensure_for_creature(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_ensure_for_creature(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.encounter_detach_creature(_encounter_id uuid, _creature_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.encounter_creatures
  WHERE encounter_id = _encounter_id AND creature_id = _creature_id;
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_detach_creature(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_detach_creature(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.encounter_end(_encounter_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.encounters
  SET status = 'ended', ended_at = now()
  WHERE id = _encounter_id AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.encounter_end(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_end(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.encounter_snapshot(_node_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(e)), '[]'::jsonb)
  FROM (
    SELECT
      e.id,
      e.node_id,
      e.encounter_key,
      e.status,
      e.state,
      e.version,
      e.started_at,
      e.last_activity_at,
      (
        SELECT COALESCE(jsonb_agg(ec.creature_id), '[]'::jsonb)
        FROM public.encounter_creatures ec WHERE ec.encounter_id = e.id
      ) AS creature_ids,
      (
        SELECT COALESCE(jsonb_agg(ep.character_id), '[]'::jsonb)
        FROM public.encounter_participants ep WHERE ep.encounter_id = e.id
      ) AS participant_ids
    FROM public.encounters e
    WHERE e.node_id = _node_id AND e.status = 'active'
  ) e;
$$;

REVOKE ALL ON FUNCTION public.encounter_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encounter_snapshot(uuid) TO authenticated, service_role;
