-- Combat2 client delivery foundation.
-- Durable synchronization is authoritative; Realtime rows are wake-up notices only.

CREATE OR REPLACE FUNCTION public.combat2_delivery_authorized(
  _character_id uuid,
  _encounter_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.owns_character(_character_id)
     AND (
       EXISTS (
         SELECT 1
           FROM public.node_fighter nf
          WHERE nf.encounter_id = _encounter_id
            AND nf.character_id = _character_id
       )
       OR EXISTS (
         SELECT 1
           FROM public.node_participation np
          WHERE np.encounter_id = _encounter_id
            AND np.character_id = _character_id
            AND np.qualification = 'qualified'
       )
     );
$function$;

CREATE OR REPLACE FUNCTION public.combat2_delivery_visible(_encounter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.characters c
     WHERE c.user_id = auth.uid()
       AND public.combat2_delivery_authorized(c.id, _encounter_id)
  );
$function$;

REVOKE ALL ON FUNCTION public.combat2_delivery_authorized(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.combat2_delivery_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat2_delivery_authorized(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.combat2_delivery_visible(uuid) TO authenticated, service_role;

-- These raw tables contain server-owned fields or payloads. Clients consume the
-- explicit projection below instead of relying on the older same-node policies.
REVOKE SELECT ON public.node_encounter FROM authenticated;
REVOKE SELECT ON public.node_creature FROM authenticated;
REVOKE SELECT ON public.node_fighter FROM authenticated;
REVOKE SELECT ON public.node_effect FROM authenticated;
REVOKE SELECT ON public.node_tick_batch FROM authenticated;
REVOKE SELECT ON public.node_participation FROM authenticated;

CREATE OR REPLACE FUNCTION public.combat2_sync(
  _character_id uuid,
  _encounter_id uuid,
  _after_tick bigint DEFAULT 0,
  _limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_encounter public.node_encounter%ROWTYPE;
  v_after bigint;
  v_limit integer;
  v_batches jsonb;
  v_first bigint;
  v_returned bigint;
  v_batch_count integer;
  v_character jsonb;
  v_fighter jsonb;
  v_creatures jsonb;
  v_effects jsonb;
  v_rewards jsonb;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.combat2_delivery_authorized(_character_id, _encounter_id) THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'unauthorized');
  END IF;

  SELECT * INTO v_encounter
    FROM public.node_encounter e
   WHERE e.id = _encounter_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'kind', 'unauthorized');
  END IF;

  v_after := GREATEST(0, LEAST(COALESCE(_after_tick, 0), v_encounter.tick));
  v_limit := GREATEST(1, LEAST(COALESCE(_limit, 25), 50));

  SELECT jsonb_build_object(
    'id', c.id,
    'hp', c.hp, 'maxHp', c.max_hp,
    'cp', c.cp, 'maxCp', c.max_cp,
    'mp', c.mp, 'maxMp', c.max_mp,
    'level', c.level, 'xp', c.xp, 'gold', c.gold
  ) INTO v_character
  FROM public.characters c
  WHERE c.id = _character_id;

  SELECT jsonb_build_object(
    'id', nf.id,
    'characterId', nf.character_id,
    'entrySeq', nf.entry_seq,
    'present', nf.present,
    'partyIdAtEntry', nf.party_id_at_entry,
    'joinedAt', nf.joined_at,
    'leftAt', nf.left_at
  ) INTO v_fighter
  FROM public.node_fighter nf
  WHERE nf.encounter_id = _encounter_id
    AND nf.character_id = _character_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', nc.id,
    'creatureId', nc.creature_id,
    'spawnSeq', nc.spawn_seq,
    'name', c.name,
    'hp', nc.hp,
    'maxHp', c.max_hp,
    'isAlive', nc.is_alive,
    'pendingAction', CASE WHEN nc.pending_action IS NULL THEN NULL ELSE jsonb_build_object(
      'abilityKey', nc.pending_action->>'ability_key',
      'resolveAtTick', (nc.pending_action->>'resolve_at_tick')::bigint
    ) END
  ) ORDER BY nc.created_at, nc.id), '[]'::jsonb)
  INTO v_creatures
  FROM public.node_creature nc
  JOIN public.creatures c ON c.id = nc.creature_id
  WHERE nc.encounter_id = _encounter_id;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', ne.id,
    'kind', ne.kind,
    'effectType', ne.effect_type,
    'abilityKey', ne.ability_key,
    'targetCharacterId', ne.target_character_id,
    'targetCreatureId', ne.target_creature_id,
    'sourceCharacterId', ne.source_character_id,
    'sourceCreatureId', ne.source_creature_id,
    'stacks', ne.stacks,
    'magnitude', ne.magnitude,
    'expiresAt', ne.expires_at,
    'nextDueAt', ne.next_due_at,
    'intervalMs', ne.interval_ms,
    'lastPulseTick', ne.last_pulse_tick,
    'isReservation', ne.is_reservation
  )) ORDER BY ne.created_at, ne.id), '[]'::jsonb)
  INTO v_effects
  FROM public.node_effect ne
  WHERE ne.encounter_id = _encounter_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'creatureId', rc.creature_id,
    'spawnSeq', rc.spawn_seq,
    'xpAwarded', rc.xp_awarded,
    'goldAwarded', rc.gold_awarded,
    'isKiller', rc.is_killer,
    'createdAt', rc.created_at
  ) ORDER BY rc.created_at, rc.id), '[]'::jsonb)
  INTO v_rewards
  FROM public.node_reward_claim rc
  WHERE rc.character_id = _character_id
    AND EXISTS (
      SELECT 1 FROM public.node_creature nc
       WHERE nc.encounter_id = _encounter_id
         AND nc.creature_id = rc.creature_id
         AND nc.spawn_seq = rc.spawn_seq
    );

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', projected.id,
    'tick', projected.tick,
    'createdAt', projected.created_at,
    'events', projected.events
  ) ORDER BY projected.tick), '[]'::jsonb)
  INTO v_batches
  FROM (
    SELECT b.id, b.tick, b.created_at,
           COALESCE((
             SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'seq', ev.value->'seq',
               'kind', ev.value->'kind',
               'actor', CASE WHEN jsonb_typeof(ev.value->'actor') = 'object' THEN
                 jsonb_strip_nulls(jsonb_build_object(
                   'type', ev.value#>>'{actor,type}',
                   'id', ev.value#>>'{actor,id}',
                   'name', ev.value#>>'{actor,name}'
                 )) END,
               'target', CASE WHEN jsonb_typeof(ev.value->'target') = 'object' THEN
                 jsonb_strip_nulls(jsonb_build_object(
                   'type', ev.value#>>'{target,type}',
                   'id', ev.value#>>'{target,id}',
                   'name', ev.value#>>'{target,name}'
                 )) END,
               'abilityKey', ev.value->'abilityKey',
               'amount', ev.value->'amount',
               'hitQuality', ev.value->'hitQuality',
               'outcomeReason', ev.value->'outcomeReason',
               'eventType', ev.value->'eventType',
               'actorCharacterId', ev.value->'actorCharacterId',
               'actorCreatureId', ev.value->'actorCreatureId',
               'targetCharacterId', ev.value->'targetCharacterId',
               'targetCreatureId', ev.value->'targetCreatureId',
               'occurredAt', ev.value->'occurredAt',
               'meta', CASE WHEN jsonb_typeof(ev.value->'meta') = 'object' THEN
                 jsonb_strip_nulls(jsonb_build_object(
                   'effectKind', ev.value#>'{meta,effectKind}',
                   'effectType', ev.value#>'{meta,effectType}',
                   'durationMs', ev.value#>'{meta,durationMs}',
                   'intervalMs', ev.value#>'{meta,intervalMs}',
                   'stance', ev.value#>'{meta,stance}',
                   'attacks', ev.value#>'{meta,attacks}',
                   'reserveHp', ev.value#>'{meta,reserveHp}',
                   'blockChance', ev.value#>'{meta,blockChance}',
                   'mode', ev.value#>'{meta,mode}',
                   'isTaunt', ev.value#>'{meta,isTaunt}',
                   'stacks', ev.value#>'{meta,stacks}',
                   'maxStacks', ev.value#>'{meta,maxStacks}',
                   'stackNoun', ev.value#>'{meta,stackNoun}',
                   'refunded', ev.value#>'{meta,refunded}',
                   'conflictsWith', ev.value#>'{meta,conflictsWith}',
                   'reservePct', ev.value#>'{meta,reservePct}',
                   'resolveAtTick', ev.value#>'{meta,resolveAtTick}',
                   'text', ev.value#>'{meta,text}',
                   'isCrit', ev.value#>'{meta,isCrit}',
                   'percentMitigated', ev.value#>'{meta,percentMitigated}',
                   'shieldBonusApplied', ev.value#>'{meta,shieldBonusApplied}',
                   'critSoftened', ev.value#>'{meta,critSoftened}',
                   'flatMitigated', ev.value#>'{meta,flatMitigated}',
                   'blocked', ev.value#>'{meta,blocked}',
                   'absorbed', ev.value#>'{meta,absorbed}',
                   'reactive', ev.value#>'{meta,reactive}',
                   'damageType', ev.value#>'{meta,damageType}',
                   'healing', ev.value#>'{meta,healing}',
                   'deathCry', ev.value#>'{meta,deathCry}',
                   'killedBy', ev.value#>'{meta,killedBy}'
                 )) END
             )) ORDER BY ev.ordinality)
             FROM jsonb_array_elements(b.events) WITH ORDINALITY AS ev(value, ordinality)
           ), '[]'::jsonb) AS events
      FROM public.node_tick_batch b
     WHERE b.encounter_id = _encounter_id
       AND b.tick > v_after
     ORDER BY b.tick ASC
     LIMIT v_limit
  ) projected;

  SELECT min((item->>'tick')::bigint), max((item->>'tick')::bigint), count(*)
    INTO v_first, v_returned, v_batch_count
    FROM jsonb_array_elements(v_batches) item;

  IF v_encounter.tick > v_after
     AND (v_batch_count = 0
       OR v_first <> v_after + 1
       OR v_batch_count <> (v_returned - v_first + 1)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'kind', 'gap_detected',
      'latest_tick', v_encounter.tick,
      'returned_through_tick', v_after,
      'has_more', true,
      'encounter', jsonb_build_object(
        'id', v_encounter.id, 'status', v_encounter.status,
        'tick', v_encounter.tick, 'stateVersion', v_encounter.state_version
      ),
      'character', v_character,
      'fighter', v_fighter,
      'creatures', v_creatures,
      'effects', v_effects,
      'rewardClaims', v_rewards,
      'batches', '[]'::jsonb
    );
  END IF;

  v_returned := COALESCE(v_returned, v_after);

  RETURN jsonb_build_object(
    'ok', true,
    'kind', 'sync',
    'latest_tick', v_encounter.tick,
    'returned_through_tick', v_returned,
    'has_more', v_returned < v_encounter.tick,
    'encounter', jsonb_build_object(
      'id', v_encounter.id, 'status', v_encounter.status,
      'tick', v_encounter.tick, 'stateVersion', v_encounter.state_version
    ),
    'character', v_character,
    'fighter', v_fighter,
    'creatures', v_creatures,
    'effects', v_effects,
    'rewardClaims', v_rewards,
    'batches', v_batches
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.combat2_sync(uuid, uuid, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat2_sync(uuid, uuid, bigint, integer) TO authenticated, service_role;

CREATE TABLE public.combat2_tick_notification (
  batch_id uuid PRIMARY KEY REFERENCES public.node_tick_batch(id) ON DELETE CASCADE,
  encounter_id uuid NOT NULL REFERENCES public.node_encounter(id) ON DELETE CASCADE,
  tick bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (encounter_id, tick)
);

ALTER TABLE public.combat2_tick_notification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.combat2_tick_notification FROM PUBLIC, anon;
GRANT SELECT ON public.combat2_tick_notification TO authenticated;
GRANT ALL ON public.combat2_tick_notification TO service_role;

CREATE POLICY "participants receive Combat2 tick notices"
ON public.combat2_tick_notification
FOR SELECT TO authenticated
USING (public.combat2_delivery_visible(encounter_id));

CREATE OR REPLACE FUNCTION public.combat2_notify_committed_tick()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.combat2_tick_notification (batch_id, encounter_id, tick)
  VALUES (NEW.id, NEW.encounter_id, NEW.tick)
  ON CONFLICT (batch_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.combat2_notify_committed_tick() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS combat2_notify_committed_tick ON public.node_tick_batch;
CREATE TRIGGER combat2_notify_committed_tick
AFTER INSERT ON public.node_tick_batch
FOR EACH ROW EXECUTE FUNCTION public.combat2_notify_committed_tick();

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'combat2_tick_notification'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.combat2_tick_notification;
  END IF;
END
$do$;
