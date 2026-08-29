-- ============================================================
-- B1/B2 correction: creature-spawn participation, out-of-tick pending
-- event delivery, authoritative stance intents, and encounter-scoped
-- commit isolation.
--
-- Additive only. No legacy combat object is touched; combat stays closed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. node_participation
--   Durable qualification for ONE creature spawn. Separate from
--   node_fighter, which remains the only source of current node
--   presence and entry order (and therefore of tank selection).
--   Rows survive the player leaving the node so a later DoT kill can
--   still pay them. Presence or party membership alone never inserts a
--   row here: qualification must be an explicit interaction.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.node_participation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  creature_id uuid NOT NULL REFERENCES public.creatures(id) ON DELETE CASCADE,
  -- spawn identity: participation in an earlier spawn_seq must never
  -- qualify anyone for a respawn.
  spawn_seq integer NOT NULL,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  qualification text NOT NULL DEFAULT 'qualified',
  qualified_by text NOT NULL,
  party_id_at_qualification uuid,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_participation_uniq
    UNIQUE (encounter_id, creature_id, spawn_seq, character_id),
  CONSTRAINT node_participation_state_chk
    CHECK (qualification IN ('qualified','disqualified')),
  CONSTRAINT node_participation_reason_chk
    CHECK (qualified_by IN ('damage','heal','absorb','debuff','buff','summon','revive'))
);
CREATE INDEX IF NOT EXISTS node_participation_spawn_idx
  ON public.node_participation (creature_id, spawn_seq)
  WHERE qualification = 'qualified';
CREATE INDEX IF NOT EXISTS node_participation_character_idx
  ON public.node_participation (character_id);

-- ------------------------------------------------------------
-- 2. node_pending_event
--   Authoritative events produced OUTSIDE a resolver tick (a future
--   combat_flee, for example). They are never delivered as their own
--   node_tick_batch, because (encounter_id, tick) is unique and already
--   owned by the committed tick. Instead the next claim surfaces them,
--   and the atomic commit folds them into its own batch and marks them
--   consumed in the same successful commit -- exactly once. A stale or
--   failed commit returns before any consumption.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.node_pending_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  actor_creature_id uuid REFERENCES public.creatures(id) ON DELETE SET NULL,
  target_character_id uuid REFERENCES public.characters(id) ON DELETE SET NULL,
  target_creature_id uuid REFERENCES public.creatures(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  consumed_tick integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT node_pending_event_consumed_chk
    CHECK ((consumed_at IS NULL) = (consumed_tick IS NULL))
);
CREATE INDEX IF NOT EXISTS node_pending_event_unconsumed_idx
  ON public.node_pending_event (encounter_id, occurred_at)
  WHERE consumed_at IS NULL;

-- ------------------------------------------------------------
-- 3. Stance intents on node_intent
--   The browser may only queue intent. Only a committed tick may
--   activate/drop a stance effect or change reserved CP. A queued
--   intent deliberately does not bump state_version.
-- ------------------------------------------------------------
ALTER TABLE public.node_intent
  ADD COLUMN IF NOT EXISTS intent_kind text NOT NULL DEFAULT 'ability',
  ADD COLUMN IF NOT EXISTS stance_key text;

ALTER TABLE public.node_intent DROP CONSTRAINT IF EXISTS node_intent_kind_chk;
ALTER TABLE public.node_intent
  ADD CONSTRAINT node_intent_kind_chk
  CHECK (intent_kind IN ('ability','stance_activate','stance_drop'));

-- Valid shapes per kind; no ambiguous nullable soup.
ALTER TABLE public.node_intent DROP CONSTRAINT IF EXISTS node_intent_shape_chk;
ALTER TABLE public.node_intent
  ADD CONSTRAINT node_intent_shape_chk CHECK (
    CASE intent_kind
      WHEN 'ability' THEN ability_key IS NOT NULL AND stance_key IS NULL
      WHEN 'stance_activate' THEN stance_key IS NOT NULL AND target_creature_id IS NULL
      WHEN 'stance_drop' THEN stance_key IS NOT NULL AND target_creature_id IS NULL
      ELSE false
    END
  );

-- ------------------------------------------------------------
-- Grants / RLS for the new tables (read-only clients, server writes)
-- ------------------------------------------------------------
GRANT SELECT ON public.node_participation TO authenticated;
GRANT SELECT ON public.node_pending_event TO authenticated;
GRANT ALL ON public.node_participation TO service_role;
GRANT ALL ON public.node_pending_event TO service_role;

ALTER TABLE public.node_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_pending_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own participation" ON public.node_participation;
CREATE POLICY "read own participation" ON public.node_participation
  FOR SELECT TO authenticated
  USING (public.owns_character(character_id));

DROP POLICY IF EXISTS "read pending events at own node" ON public.node_pending_event;
CREATE POLICY "read pending events at own node" ON public.node_pending_event
  FOR SELECT TO authenticated
  USING (public.encounter_visible_to_caller(encounter_id));

DROP TRIGGER IF EXISTS node_participation_touch ON public.node_participation;
CREATE TRIGGER node_participation_touch BEFORE UPDATE ON public.node_participation
  FOR EACH ROW EXECUTE FUNCTION public.combat2_touch_updated_at();

-- ============================================================
-- 4. node_tick_claim: surface participation and unconsumed pending events.
--    Signature unchanged (no overload).
-- ============================================================
CREATE OR REPLACE FUNCTION public.node_tick_claim(
  _node_id uuid,
  _lease_ms integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e            public.node_encounter;
  v_candidate  integer;
  v_token      uuid;
  v_cutoff     bigint;
  v_snapshot   jsonb;
BEGIN
  SELECT * INTO e
  FROM public.node_encounter
  WHERE node_id = _node_id AND status = 'active'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_claim', 'reason', 'locked_or_absent');
  END IF;

  IF e.next_due_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'not_due', 'next_due_at', e.next_due_at);
  END IF;

  IF e.claimed_tick IS NOT NULL AND e.claim_expires_at IS NOT NULL AND e.claim_expires_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'no_claim', 'reason', 'in_flight');
  END IF;

  v_candidate := e.tick + 1;
  v_token     := gen_random_uuid();

  SELECT max(seq) INTO v_cutoff
  FROM public.node_intent
  WHERE encounter_id = e.id AND status = 'pending';

  UPDATE public.node_encounter
     SET claimed_tick      = v_candidate,
         claim_token       = v_token,
         claim_expires_at  = now() + make_interval(secs => _lease_ms / 1000.0),
         intent_cutoff_seq = v_cutoff
   WHERE id = e.id;

  v_snapshot := jsonb_build_object(
    'encounter', jsonb_build_object(
      'id', e.id, 'node_id', e.node_id, 'tick', e.tick,
      'candidate_tick', v_candidate, 'state_version', e.state_version,
      'now', now()
    ),
    'creatures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', nc.id, 'creature_id', nc.creature_id, 'spawn_seq', nc.spawn_seq,
        'hp', nc.hp, 'is_alive', nc.is_alive, 'pending_action', nc.pending_action,
        'tank_fighter_id', nc.tank_fighter_id,
        'name', cr.name, 'level', cr.level, 'max_hp', cr.max_hp, 'ac', cr.ac,
        'stats', cr.stats, 'rarity', cr.rarity, 'is_humanoid', cr.is_humanoid,
        'is_aggressive', cr.is_aggressive,
        'boss_crit_flavors', cr.boss_crit_flavors, 'boss_death_cry', cr.boss_death_cry
      ) ORDER BY nc.created_at)
      FROM public.node_creature nc
      JOIN public.creatures cr ON cr.id = nc.creature_id
      WHERE nc.encounter_id = e.id
    ), '[]'::jsonb),
    'fighters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', nf.id, 'character_id', nf.character_id, 'entry_seq', nf.entry_seq,
        'present', nf.present, 'party_id_at_entry', nf.party_id_at_entry,
        'name', ch.name, 'class', ch.class, 'race', ch.race, 'level', ch.level,
        'hp', ch.hp, 'max_hp', ch.max_hp, 'cp', ch.cp, 'max_cp', ch.max_cp,
        'mp', ch.mp, 'max_mp', ch.max_mp, 'ac', ch.ac,
        'str', ch.str, 'dex', ch.dex, 'con', ch.con,
        'int', ch.int, 'wis', ch.wis, 'cha', ch.cha,
        'party_id', pm.party_id,
        'equipment', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'slot', ci.equipped_slot, 'item_id', ci.item_id,
            'inventory_id', ci.id, 'durability', ci.current_durability,
            'applied_gems', ci.applied_gems, 'stat_override', ci.stat_override,
            'crafted_level', ci.crafted_level
          ) ORDER BY ci.equipped_slot)
          FROM public.character_inventory ci
          WHERE ci.character_id = ch.id AND ci.equipped_slot IS NOT NULL
        ), '[]'::jsonb)
      ) ORDER BY nf.entry_seq)
      FROM public.node_fighter nf
      JOIN public.characters ch ON ch.id = nf.character_id
      LEFT JOIN public.party_members pm ON pm.character_id = ch.id
      WHERE nf.encounter_id = e.id
    ), '[]'::jsonb),
    'effects', COALESCE((
      SELECT jsonb_agg(to_jsonb(ne) ORDER BY ne.created_at)
      FROM public.node_effect ne WHERE ne.encounter_id = e.id
    ), '[]'::jsonb),
    'intents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ni.id, 'seq', ni.seq, 'character_id', ni.character_id,
        'intent_kind', ni.intent_kind,
        'ability_key', ni.ability_key, 'stance_key', ni.stance_key,
        'target_creature_id', ni.target_creature_id
      ) ORDER BY ni.seq)
      FROM public.node_intent ni
      WHERE ni.encounter_id = e.id AND ni.status = 'pending'
        AND v_cutoff IS NOT NULL AND ni.seq <= v_cutoff
    ), '[]'::jsonb),
    -- durable creature-spawn qualification (reward eligibility source)
    'participation', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', np.id, 'creature_id', np.creature_id, 'spawn_seq', np.spawn_seq,
        'character_id', np.character_id, 'qualification', np.qualification,
        'qualified_by', np.qualified_by,
        'party_id_at_qualification', np.party_id_at_qualification
      ) ORDER BY np.first_at)
      FROM public.node_participation np WHERE np.encounter_id = e.id
    ), '[]'::jsonb),
    -- out-of-tick events awaiting delivery in this tick's batch
    'pending_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', pe.id, 'event_type', pe.event_type,
        'actor_character_id', pe.actor_character_id,
        'actor_creature_id', pe.actor_creature_id,
        'target_character_id', pe.target_character_id,
        'target_creature_id', pe.target_creature_id,
        'payload', pe.payload, 'occurred_at', pe.occurred_at
      ) ORDER BY pe.occurred_at, pe.id)
      FROM public.node_pending_event pe
      WHERE pe.encounter_id = e.id AND pe.consumed_at IS NULL
    ), '[]'::jsonb),
    'boss_abilities', COALESCE((
      SELECT jsonb_agg(to_jsonb(ba) ORDER BY ba.ability_key)
      FROM public.boss_ability ba
      WHERE ba.creature_id IN (
        SELECT creature_id FROM public.node_creature WHERE encounter_id = e.id
      )
    ), '[]'::jsonb)
  );

  RETURN jsonb_build_object(
    'ok', true, 'kind', 'claimed',
    'encounter_id', e.id,
    'last_committed_tick', e.tick,
    'candidate_tick', v_candidate,
    'state_version', e.state_version,
    'claim_token', v_token,
    'intent_cutoff_seq', v_cutoff,
    'snapshot', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.node_tick_claim(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_claim(uuid, integer) TO service_role;


-- ============================================================
-- 5. node_tick_commit: every payload-derived id is validated against the
--    claimed encounter BEFORE any mutation. A single foreign id fails the
--    whole commit with no partial application, and consumes neither
--    intents nor pending events. Signature unchanged; the pending events
--    to deliver travel in _proposed->'pending_event_ids'.
-- ============================================================
CREATE OR REPLACE FUNCTION public.node_tick_commit(
  _encounter_id uuid,
  _claim_token uuid,
  _candidate_tick integer,
  _expected_last_tick integer,
  _expected_state_version bigint,
  _intent_ids uuid[],
  _proposed jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e             public.node_encounter;
  rec           jsonb;
  v_bad         text;
  v_pending_ids uuid[];
  v_events      jsonb;
  v_delivered   jsonb;
BEGIN
  SELECT * INTO e FROM public.node_encounter WHERE id = _encounter_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_claim', 'reason', 'no_encounter');
  END IF;

  IF e.tick >= _candidate_tick THEN
    RETURN jsonb_build_object('ok', true, 'kind', 'already_committed', 'tick', e.tick);
  END IF;

  IF e.claim_token IS DISTINCT FROM _claim_token
     OR e.claimed_tick IS DISTINCT FROM _candidate_tick
     OR e.claim_expires_at IS NULL
     OR e.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_claim');
  END IF;

  IF e.tick IS DISTINCT FROM _expected_last_tick
     OR e.state_version IS DISTINCT FROM _expected_state_version THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'stale_snapshot');
  END IF;

  v_pending_ids := ARRAY(
    SELECT (value #>> '{}')::uuid
    FROM jsonb_array_elements(COALESCE(_proposed->'pending_event_ids', '[]'::jsonb))
  );

  -- ---------- encounter-scope validation (no mutation yet) ----------
  -- characters: must be a fighter of THIS encounter
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (SELECT (value->>'id')::uuid AS id
        FROM jsonb_array_elements(COALESCE(_proposed->'characters','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                    WHERE nf.encounter_id = _encounter_id AND nf.character_id = x.id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'characters', 'ids', v_bad);
  END IF;

  -- creatures: node_creature row must belong to this encounter and match
  -- the declared (creature_id, spawn_seq) identity.
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (SELECT (value->>'id')::uuid AS id,
               (value->>'creature_id')::uuid AS creature_id,
               (value->>'spawn_seq')::int AS spawn_seq
        FROM jsonb_array_elements(COALESCE(_proposed->'creatures','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_creature nc
                    WHERE nc.id = x.id AND nc.encounter_id = _encounter_id
                      AND nc.creature_id = x.creature_id
                      AND nc.spawn_seq = x.spawn_seq);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'creatures', 'ids', v_bad);
  END IF;

  -- effects (update + delete)
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (
    SELECT (value->>'id')::uuid AS id
    FROM jsonb_array_elements(COALESCE(_proposed->'effects_update','[]'::jsonb))
    UNION ALL
    SELECT (value #>> '{}')::uuid
    FROM jsonb_array_elements(COALESCE(_proposed->'effects_delete','[]'::jsonb))
  ) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_effect ne
                    WHERE ne.id = x.id AND ne.encounter_id = _encounter_id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'effects', 'ids', v_bad);
  END IF;

  -- fighters
  SELECT string_agg(DISTINCT x.id::text, ',') INTO v_bad
  FROM (SELECT (value->>'id')::uuid AS id
        FROM jsonb_array_elements(COALESCE(_proposed->'fighters','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                    WHERE nf.id = x.id AND nf.encounter_id = _encounter_id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'fighters', 'ids', v_bad);
  END IF;

  -- rewards: the creature spawn must belong to this encounter, and the
  -- character must be durably qualified for exactly that spawn.
  SELECT string_agg(DISTINCT x.character_id::text, ',') INTO v_bad
  FROM (SELECT (value->>'creature_id')::uuid AS creature_id,
               (value->>'spawn_seq')::int AS spawn_seq,
               (value->>'character_id')::uuid AS character_id
        FROM jsonb_array_elements(COALESCE(_proposed->'rewards','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_creature nc
                    WHERE nc.encounter_id = _encounter_id
                      AND nc.creature_id = x.creature_id
                      AND nc.spawn_seq = x.spawn_seq)
     OR NOT EXISTS (SELECT 1 FROM public.node_participation np
                    WHERE np.encounter_id = _encounter_id
                      AND np.creature_id = x.creature_id
                      AND np.spawn_seq = x.spawn_seq
                      AND np.character_id = x.character_id
                      AND np.qualification = 'qualified');
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'rewards', 'ids', v_bad);
  END IF;

  -- participation upserts must name a creature spawn of this encounter and
  -- a character that entered this encounter.
  SELECT string_agg(DISTINCT x.character_id::text, ',') INTO v_bad
  FROM (SELECT (value->>'creature_id')::uuid AS creature_id,
               (value->>'spawn_seq')::int AS spawn_seq,
               (value->>'character_id')::uuid AS character_id
        FROM jsonb_array_elements(COALESCE(_proposed->'participation','[]'::jsonb))) x
  WHERE NOT EXISTS (SELECT 1 FROM public.node_creature nc
                    WHERE nc.encounter_id = _encounter_id
                      AND nc.creature_id = x.creature_id
                      AND nc.spawn_seq = x.spawn_seq)
     OR NOT EXISTS (SELECT 1 FROM public.node_fighter nf
                    WHERE nf.encounter_id = _encounter_id
                      AND nf.character_id = x.character_id);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'participation', 'ids', v_bad);
  END IF;

  -- intents must be pending intents of this encounter, within the cutoff
  SELECT string_agg(DISTINCT t.id::text, ',') INTO v_bad
  FROM unnest(COALESCE(_intent_ids, ARRAY[]::uuid[])) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.node_intent ni
                    WHERE ni.id = t.id AND ni.encounter_id = _encounter_id
                      AND ni.status = 'pending'
                      AND (e.intent_cutoff_seq IS NULL OR ni.seq <= e.intent_cutoff_seq));
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'intents', 'ids', v_bad);
  END IF;

  -- pending events must be unconsumed events of this encounter
  SELECT string_agg(DISTINCT t.id::text, ',') INTO v_bad
  FROM unnest(v_pending_ids) AS t(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.node_pending_event pe
                    WHERE pe.id = t.id AND pe.encounter_id = _encounter_id
                      AND pe.consumed_at IS NULL);
  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'foreign_reference',
                              'relation', 'pending_events', 'ids', v_bad);
  END IF;

  -- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'characters', '[]'::jsonb)) LOOP
    UPDATE public.characters c
       SET hp = LEAST(GREATEST(COALESCE((rec->>'hp')::int, c.hp), 0), c.max_hp),
           cp = LEAST(GREATEST(COALESCE((rec->>'cp')::int, c.cp), 0), c.max_cp),
           mp = LEAST(GREATEST(COALESCE((rec->>'mp')::int, c.mp), 0), c.max_mp),
           last_death_at = CASE WHEN COALESCE((rec->>'died')::boolean, false)
                                THEN now() ELSE c.last_death_at END
     WHERE c.id = (rec->>'id')::uuid
       AND EXISTS (SELECT 1 FROM public.node_fighter nf
                   WHERE nf.encounter_id = _encounter_id AND nf.character_id = c.id);
  END LOOP;

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'creatures', '[]'::jsonb)) LOOP
    UPDATE public.node_creature nc
       SET hp              = GREATEST(COALESCE((rec->>'hp')::int, nc.hp), 0),
           is_alive        = COALESCE((rec->>'is_alive')::boolean, nc.is_alive) AND nc.is_alive,
           pending_action  = CASE WHEN rec ? 'pending_action'
                                  THEN NULLIF(rec->'pending_action', 'null'::jsonb)
                                  ELSE nc.pending_action END,
           tank_fighter_id = CASE WHEN rec ? 'tank_fighter_id'
                                  THEN NULLIF(rec->>'tank_fighter_id','')::uuid
                                  ELSE nc.tank_fighter_id END,
           last_damaged_at = CASE WHEN COALESCE((rec->>'damaged')::boolean, false)
                                  THEN now() ELSE nc.last_damaged_at END,
           died_at         = CASE WHEN nc.is_alive
                                   AND COALESCE((rec->>'is_alive')::boolean, true) = false
                                  THEN now() ELSE nc.died_at END
     WHERE nc.id = (rec->>'id')::uuid
       AND nc.encounter_id = _encounter_id;

    -- mirror death onto the authored creature row, fenced by spawn_seq
    UPDATE public.creatures cr
       SET hp = GREATEST(COALESCE((rec->>'hp')::int, cr.hp), 0),
           is_alive = COALESCE((rec->>'is_alive')::boolean, cr.is_alive) AND cr.is_alive,
           died_at = CASE WHEN cr.is_alive
                            AND COALESCE((rec->>'is_alive')::boolean, true) = false
                           THEN now() ELSE cr.died_at END,
           last_damaged_at = CASE WHEN COALESCE((rec->>'damaged')::boolean, false)
                                  THEN now() ELSE cr.last_damaged_at END
     WHERE cr.id = (rec->>'creature_id')::uuid
       AND cr.spawn_seq = (rec->>'spawn_seq')::int
       AND EXISTS (SELECT 1 FROM public.node_creature nc2
                   WHERE nc2.encounter_id = _encounter_id
                     AND nc2.creature_id = cr.id
                     AND nc2.spawn_seq = cr.spawn_seq);
  END LOOP;

  DELETE FROM public.node_effect
   WHERE encounter_id = _encounter_id
     AND id IN (
       SELECT (value #>> '{}')::uuid
       FROM jsonb_array_elements(COALESCE(_proposed->'effects_delete', '[]'::jsonb))
     );

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'effects_update', '[]'::jsonb)) LOOP
    UPDATE public.node_effect ne
       SET stacks          = COALESCE((rec->>'stacks')::int, ne.stacks),
           magnitude       = COALESCE((rec->>'magnitude')::numeric, ne.magnitude),
           expires_at      = CASE WHEN rec ? 'expires_at'
                                  THEN NULLIF(rec->>'expires_at','')::timestamptz
                                  ELSE ne.expires_at END,
           next_due_at     = CASE WHEN rec ? 'next_due_at'
                                  THEN NULLIF(rec->>'next_due_at','')::timestamptz
                                  ELSE ne.next_due_at END,
           last_pulse_tick = COALESCE((rec->>'last_pulse_tick')::int, ne.last_pulse_tick)
     WHERE ne.id = (rec->>'id')::uuid
       AND ne.encounter_id = _encounter_id;
  END LOOP;

  INSERT INTO public.node_effect (
    encounter_id, kind, effect_type, ability_key,
    target_character_id, target_creature_id, source_character_id, source_creature_id,
    stacks, magnitude, config, expires_at, next_due_at, interval_ms,
    last_pulse_tick, is_reservation
  )
  SELECT _encounter_id,
         rec2->>'kind', rec2->>'effect_type', rec2->>'ability_key',
         NULLIF(rec2->>'target_character_id','')::uuid,
         NULLIF(rec2->>'target_creature_id','')::uuid,
         NULLIF(rec2->>'source_character_id','')::uuid,
         NULLIF(rec2->>'source_creature_id','')::uuid,
         COALESCE((rec2->>'stacks')::int, 1),
         NULLIF(rec2->>'magnitude','')::numeric,
         COALESCE(rec2->'config', '{}'::jsonb),
         NULLIF(rec2->>'expires_at','')::timestamptz,
         NULLIF(rec2->>'next_due_at','')::timestamptz,
         NULLIF(rec2->>'interval_ms','')::int,
         NULLIF(rec2->>'last_pulse_tick','')::int,
         COALESCE((rec2->>'is_reservation')::boolean, false)
  FROM jsonb_array_elements(COALESCE(_proposed->'effects_insert', '[]'::jsonb)) AS rec2;

  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'fighters', '[]'::jsonb)) LOOP
    UPDATE public.node_fighter nf
       SET present = COALESCE((rec->>'present')::boolean, nf.present),
           left_at = CASE WHEN COALESCE((rec->>'present')::boolean, true) = false
                            AND nf.left_at IS NULL
                          THEN now() ELSE nf.left_at END
     WHERE nf.id = (rec->>'id')::uuid
       AND nf.encounter_id = _encounter_id;
  END LOOP;

  -- participation: durable per-spawn qualification, written by the tick only
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'participation', '[]'::jsonb)) LOOP
    INSERT INTO public.node_participation
      (encounter_id, creature_id, spawn_seq, character_id,
       qualification, qualified_by, party_id_at_qualification)
    VALUES (_encounter_id, (rec->>'creature_id')::uuid, (rec->>'spawn_seq')::int,
            (rec->>'character_id')::uuid,
            COALESCE(NULLIF(rec->>'qualification',''), 'qualified'),
            rec->>'qualified_by',
            NULLIF(rec->>'party_id_at_qualification','')::uuid)
    ON CONFLICT (encounter_id, creature_id, spawn_seq, character_id)
    DO UPDATE SET last_at = now(),
                  qualification = COALESCE(NULLIF(EXCLUDED.qualification,''),
                                           node_participation.qualification);
  END LOOP;

  -- rewards: exactly once per (creature, spawn_seq, character)
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'rewards', '[]'::jsonb)) LOOP
    INSERT INTO public.node_reward_claim
      (creature_id, spawn_seq, character_id, xp_awarded, gold_awarded, is_killer)
    VALUES ((rec->>'creature_id')::uuid, (rec->>'spawn_seq')::int,
            (rec->>'character_id')::uuid,
            COALESCE((rec->>'xp_awarded')::int, 0),
            COALESCE((rec->>'gold_awarded')::int, 0),
            COALESCE((rec->>'is_killer')::boolean, false))
    ON CONFLICT (creature_id, spawn_seq, character_id) DO NOTHING;

    IF FOUND THEN
      PERFORM set_config('app.trusted_rpc', 'true', true);
      UPDATE public.characters
         SET xp   = xp   + COALESCE((rec->>'xp_awarded')::int, 0),
             gold = gold + COALESCE((rec->>'gold_awarded')::int, 0)
       WHERE id = (rec->>'character_id')::uuid;
    END IF;
  END LOOP;

  -- ---- committed batch: exactly one per (encounter_id, tick). Pending
  -- events are folded into THIS batch, never delivered as their own. ----
  v_events := COALESCE(_proposed->'events', '[]'::jsonb);
  IF array_length(v_pending_ids, 1) > 0 THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', 'pending_event', 'eventType', pe.event_type,
             'pendingEventId', pe.id,
             'actorCharacterId', pe.actor_character_id,
             'actorCreatureId', pe.actor_creature_id,
             'targetCharacterId', pe.target_character_id,
             'targetCreatureId', pe.target_creature_id,
             'payload', pe.payload, 'occurredAt', pe.occurred_at
           ) ORDER BY pe.occurred_at, pe.id), '[]'::jsonb)
      INTO v_delivered
      FROM public.node_pending_event pe
     WHERE pe.encounter_id = _encounter_id
       AND pe.id = ANY(v_pending_ids)
       AND pe.consumed_at IS NULL;
    v_events := v_events || v_delivered;
  END IF;

  INSERT INTO public.node_tick_batch (encounter_id, tick, events)
  VALUES (_encounter_id, _candidate_tick, v_events)
  ON CONFLICT (encounter_id, tick) DO NOTHING;

  -- exactly-once consumption, inside the same successful commit
  IF array_length(v_pending_ids, 1) > 0 THEN
    UPDATE public.node_pending_event
       SET consumed_at = now(), consumed_tick = _candidate_tick
     WHERE encounter_id = _encounter_id
       AND id = ANY(v_pending_ids)
       AND consumed_at IS NULL;
  END IF;

  IF _intent_ids IS NOT NULL AND array_length(_intent_ids, 1) > 0 THEN
    UPDATE public.node_intent
       SET status = 'consumed'
     WHERE id = ANY(_intent_ids)
       AND encounter_id = _encounter_id
       AND status = 'pending';
  END IF;

  UPDATE public.node_encounter
     SET tick             = _candidate_tick,
         state_version    = state_version + 1,
         claimed_tick     = NULL,
         claim_token      = NULL,
         claim_expires_at = NULL,
         next_due_at      = greatest(now(), next_due_at) + interval '2 seconds',
         status           = COALESCE(NULLIF(_proposed->>'status',''), status)
   WHERE id = _encounter_id;

  RETURN jsonb_build_object('ok', true, 'kind', 'committed', 'tick', _candidate_tick);
END;
$$;

REVOKE ALL ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid, uuid, integer, integer, bigint, uuid[], jsonb) TO service_role;

-- Record an authoritative out-of-tick event (server-only; used later by combat_flee).
CREATE OR REPLACE FUNCTION public.node_pending_event_record(
  _encounter_id uuid,
  _event_type text,
  _actor_character_id uuid DEFAULT NULL,
  _target_character_id uuid DEFAULT NULL,
  _target_creature_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.node_pending_event
    (encounter_id, event_type, actor_character_id, target_character_id,
     target_creature_id, payload)
  VALUES (_encounter_id, _event_type, _actor_character_id, _target_character_id,
          _target_creature_id, COALESCE(_payload, '{}'::jsonb))
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.node_pending_event_record(uuid, text, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.node_pending_event_record(uuid, text, uuid, uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.node_pending_event_record(uuid, text, uuid, uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.node_pending_event_record(uuid, text, uuid, uuid, uuid, jsonb) TO service_role;