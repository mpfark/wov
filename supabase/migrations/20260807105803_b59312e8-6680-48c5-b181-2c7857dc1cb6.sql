-- 1. Engagements: durable "this character is fighting this creature"
CREATE TABLE public.encounter_engagements (
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_action_at timestamptz NOT NULL DEFAULT now(),
  party_id_at_join uuid,
  PRIMARY KEY (encounter_id, creature_id, character_id)
);

CREATE INDEX idx_encounter_engagements_encounter ON public.encounter_engagements (encounter_id, joined_at, creature_id);
CREATE INDEX idx_encounter_engagements_character ON public.encounter_engagements (character_id);
CREATE INDEX idx_encounter_engagements_creature ON public.encounter_engagements (creature_id);

GRANT SELECT ON public.encounter_engagements TO authenticated;
GRANT ALL ON public.encounter_engagements TO service_role;
ALTER TABLE public.encounter_engagements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read engagements in their encounters"
ON public.encounter_engagements FOR SELECT TO authenticated
USING (
  public.owns_character(character_id)
  OR EXISTS (
    SELECT 1 FROM public.encounter_engagements e2
    JOIN public.characters c ON c.id = e2.character_id
    WHERE e2.encounter_id = encounter_engagements.encounter_id
      AND c.user_id = auth.uid()
  )
);

-- 2. Durable player intents
CREATE TABLE public.combat_actions (
  id uuid PRIMARY KEY,
  encounter_id uuid NOT NULL REFERENCES public.encounters(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.nodes(id),
  ability_key text NOT NULL,
  target_creature_id uuid REFERENCES public.creatures(id) ON DELETE SET NULL,
  target_character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  client_seq integer NOT NULL DEFAULT 0,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  eligible_after_ms bigint,
  status text NOT NULL DEFAULT 'pending',
  consumed_tick bigint,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT combat_actions_status_chk CHECK (status IN ('pending','consumed','rejected','cancelled'))
);

CREATE INDEX idx_combat_actions_pending ON public.combat_actions (encounter_id, status, submitted_at);
CREATE UNIQUE INDEX idx_combat_actions_single_pending
  ON public.combat_actions (character_id)
  WHERE status = 'pending';

GRANT SELECT ON public.combat_actions TO authenticated;
GRANT ALL ON public.combat_actions TO service_role;
ALTER TABLE public.combat_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read their own combat actions"
ON public.combat_actions FOR SELECT TO authenticated
USING (public.owns_character(character_id));

CREATE TRIGGER trg_combat_actions_updated_at
BEFORE UPDATE ON public.combat_actions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 3. Engagement join
CREATE OR REPLACE FUNCTION public.join_encounter_engagement(_character_id uuid, _creature_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_encounter_id uuid;
  v_node_id uuid;
  v_char_node uuid;
  v_party_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'not your character';
  END IF;

  SELECT node_id INTO v_node_id FROM public.creatures WHERE id = _creature_id AND is_alive = true;
  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'creature unavailable';
  END IF;

  SELECT current_node_id INTO v_char_node FROM public.characters WHERE id = _character_id AND hp > 0;
  IF v_char_node IS NULL OR v_char_node <> v_node_id THEN
    RAISE EXCEPTION 'character not present at creature node';
  END IF;

  v_encounter_id := public.encounter_ensure_for_creature(_creature_id);

  SELECT party_id INTO v_party_id
  FROM public.party_members
  WHERE character_id = _character_id AND status = 'active'
  LIMIT 1;

  INSERT INTO public.encounter_participants (encounter_id, character_id)
  VALUES (v_encounter_id, _character_id)
  ON CONFLICT (encounter_id, character_id) DO UPDATE SET last_action_at = now();

  INSERT INTO public.encounter_engagements (encounter_id, creature_id, character_id, party_id_at_join)
  VALUES (v_encounter_id, _creature_id, _character_id, v_party_id)
  ON CONFLICT (encounter_id, creature_id, character_id)
  DO UPDATE SET last_action_at = now();

  RETURN v_encounter_id;
END;
$$;

-- 4. Durable action submission
CREATE OR REPLACE FUNCTION public.submit_combat_action(
  _id uuid,
  _character_id uuid,
  _ability_key text,
  _target_creature_id uuid DEFAULT NULL,
  _target_character_id uuid DEFAULT NULL,
  _client_seq integer DEFAULT 0
)
RETURNS public.combat_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_existing public.combat_actions;
  v_row public.combat_actions;
  v_encounter_id uuid;
  v_node_id uuid;
  v_owns boolean;
BEGIN
  SELECT * INTO v_existing FROM public.combat_actions WHERE id = _id;
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'not your character';
  END IF;

  SELECT current_node_id INTO v_node_id
  FROM public.characters
  WHERE id = _character_id AND hp > 0;
  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'character unavailable';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.character_ability_loadout l
    JOIN public.abilities a ON a.id = l.ability_id
    WHERE l.character_id = _character_id AND a.ability_key = _ability_key
  ) INTO v_owns;
  IF NOT v_owns THEN
    RAISE EXCEPTION 'ability not in loadout';
  END IF;

  IF _target_creature_id IS NOT NULL THEN
    v_encounter_id := public.join_encounter_engagement(_character_id, _target_creature_id);
  ELSE
    v_encounter_id := public.encounter_ensure_for_character(_character_id);
    INSERT INTO public.encounter_participants (encounter_id, character_id)
    VALUES (v_encounter_id, _character_id)
    ON CONFLICT (encounter_id, character_id) DO UPDATE SET last_action_at = now();
  END IF;

  -- Single pending slot: replace any prior pending intent
  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'superseded'
  WHERE character_id = _character_id AND status = 'pending';

  INSERT INTO public.combat_actions (
    id, encounter_id, character_id, node_id, ability_key,
    target_creature_id, target_character_id, client_seq
  ) VALUES (
    _id, v_encounter_id, _character_id, v_node_id, _ability_key,
    _target_creature_id, _target_character_id, COALESCE(_client_seq, 0)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- 5. Cancellation and cleanup
CREATE OR REPLACE FUNCTION public.cancel_combat_action(_id uuid, _reason text DEFAULT 'cancelled')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.combat_actions ca
  SET status = 'cancelled', reject_reason = _reason
  WHERE ca.id = _id
    AND ca.status = 'pending'
    AND (auth.uid() IS NULL OR public.owns_character(ca.character_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_encounter_engagements(_character_id uuid, _creature_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.owns_character(_character_id) THEN
    RAISE EXCEPTION 'not your character';
  END IF;

  DELETE FROM public.encounter_engagements
  WHERE character_id = _character_id
    AND (_creature_id IS NULL OR creature_id = _creature_id);

  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'disengaged'
  WHERE character_id = _character_id
    AND status = 'pending'
    AND (_creature_id IS NULL OR target_creature_id = _creature_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_creature_engagements(_creature_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.encounter_engagements WHERE creature_id = _creature_id;

  UPDATE public.combat_actions
  SET status = 'cancelled', reject_reason = 'target_dead'
  WHERE target_creature_id = _creature_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_encounter_engagement(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_combat_action(uuid, uuid, text, uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_combat_action(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_encounter_engagements(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.purge_creature_engagements(uuid) TO service_role;