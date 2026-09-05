-- Durable, server-authoritative ordinary adjacent movement. Special travel is excluded.
CREATE TABLE public.combat2_departure_request (
  request_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  origin_node_id uuid NOT NULL REFERENCES public.nodes(id),
  destination_node_id uuid NOT NULL REFERENCES public.nodes(id),
  direction text NOT NULL,
  encounter_id uuid REFERENCES public.node_encounter(id) ON DELETE SET NULL,
  fighter_id uuid REFERENCES public.node_fighter(id) ON DELETE SET NULL,
  fighter_entry_seq bigint,
  arrival_group_id uuid REFERENCES public.node_arrival_group(id) ON DELETE SET NULL,
  cost integer NOT NULL CHECK (cost >= 0),
  resource_kind text NOT NULL DEFAULT 'mp' CHECK (resource_kind = 'mp'),
  status text NOT NULL CHECK (status IN ('queued','moved','dead')),
  resolved_tick integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE public.combat2_departure_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_departure_request FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.combat2_departure_request TO service_role;

-- Browser-owned row updates, summon acceptance and follower movement cannot bypass
-- an active Combat2 fighter. Trusted service-role administration remains separate.
CREATE OR REPLACE FUNCTION public.combat2_guard_owned_location_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.current_node_id IS DISTINCT FROM NEW.current_node_id
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('app.combat2_depart_authorized', true), '') <> 'true'
     AND EXISTS (
       SELECT 1 FROM public.node_fighter nf
       JOIN public.node_encounter e ON e.id = nf.encounter_id
       WHERE nf.character_id = OLD.id AND nf.present AND e.status = 'active'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'combat2_depart_required';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS combat2_guard_owned_location_write ON public.characters;
CREATE TRIGGER combat2_guard_owned_location_write
BEFORE UPDATE OF current_node_id ON public.characters
FOR EACH ROW EXECUTE FUNCTION public.combat2_guard_owned_location_write();

CREATE OR REPLACE FUNCTION public.combat2_depart(
  _character_id uuid,
  _destination_node_id uuid,
  _request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prior public.combat2_departure_request;
  v_character public.characters;
  v_encounter public.node_encounter;
  v_fighter public.node_fighter;
  v_connection jsonb;
  v_cost integer;
  v_capacity integer;
  v_bag numeric;
  v_event uuid;
  v_version bigint;
  v_origin uuid;
BEGIN
  IF _character_id IS NULL OR _destination_node_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_request');
  END IF;
  IF NOT public.owns_character(_character_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','not_authorized');
  END IF;

  -- Lock order: request advisory -> origin-node advisory -> encounter -> character.
  -- This matches combat_enter's node advisory and node_tick_commit's encounter-first order.
  PERFORM pg_advisory_xact_lock(hashtextextended('combat2_depart_request:' || _request_id::text,0));

  SELECT * INTO v_prior FROM public.combat2_departure_request WHERE request_id = _request_id;
  IF FOUND THEN
    IF v_prior.character_id IS DISTINCT FROM _character_id
       OR v_prior.destination_node_id IS DISTINCT FROM _destination_node_id THEN
      RETURN jsonb_build_object('ok',false,'kind','request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,
      'kind',CASE v_prior.status WHEN 'queued' THEN 'already_queued' WHEN 'moved' THEN 'already_moved' ELSE 'dead' END,
      'request_id',v_prior.request_id,'origin_node_id',v_prior.origin_node_id,
      'destination_node_id',v_prior.destination_node_id,'cost',v_prior.cost,'resource_kind',v_prior.resource_kind);
  END IF;

  SELECT * INTO v_character FROM public.characters WHERE id = _character_id;
  IF NOT FOUND OR v_character.current_node_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','stale_origin'); END IF;
  v_origin := v_character.current_node_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:' || v_origin::text,0));
  SELECT * INTO v_encounter FROM public.node_encounter
    WHERE node_id = v_origin AND status = 'active' FOR UPDATE;
  SELECT * INTO v_character FROM public.characters WHERE id = _character_id FOR UPDATE;
  IF v_character.current_node_id IS DISTINCT FROM v_origin THEN RETURN jsonb_build_object('ok',false,'kind','stale_origin'); END IF;
  IF v_character.hp <= 0 THEN RETURN jsonb_build_object('ok',false,'kind','dead'); END IF;
  IF _destination_node_id = v_character.current_node_id OR NOT EXISTS (SELECT 1 FROM public.nodes WHERE id=_destination_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_destination');
  END IF;

  SELECT conn INTO v_connection FROM public.nodes n
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n.connections,'[]'::jsonb)) conn
  WHERE n.id=v_character.current_node_id AND conn->>'node_id'=_destination_node_id::text LIMIT 1;
  IF v_connection IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_adjacent'); END IF;
  IF COALESCE((v_connection->>'hidden')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','hidden');
  END IF;
  IF COALESCE(v_connection->>'direction','') = '' THEN
    RETURN jsonb_build_object('ok',false,'kind','unsupported_transition','reason','missing_direction');
  END IF;
  IF COALESCE((v_connection->>'locked')::boolean,false) AND NOT EXISTS (
    SELECT 1 FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=_character_id AND lower(i.name)=lower(COALESCE(v_connection->>'lock_key',''))
  ) THEN RETURN jsonb_build_object('ok',false,'kind','locked'); END IF;

  v_capacity := GREATEST(12 + FLOOR((COALESCE(v_character.str,10)-10)/2.0)::int,10);
  SELECT COALESCE(SUM(CASE WHEN i.item_type='consumable' THEN 1.0/3.0 ELSE 1.0 END),0)
    INTO v_bag FROM public.character_inventory ci JOIN public.items i ON i.id=ci.item_id
    WHERE ci.character_id=_character_id AND ci.equipped_slot IS NULL;
  v_cost := 5 + GREATEST(0,CEIL(v_bag)::int-v_capacity)*3;
  IF COALESCE(v_character.mp,0) < v_cost THEN RETURN jsonb_build_object('ok',false,'kind','insufficient_resource','resource_kind','mp'); END IF;

  IF v_encounter.id IS NOT NULL THEN
    SELECT * INTO v_fighter FROM public.node_fighter
      WHERE encounter_id=v_encounter.id AND character_id=_character_id AND present FOR UPDATE;
  END IF;
  IF v_fighter.id IS NULL THEN
    INSERT INTO public.combat2_departure_request(request_id,character_id,origin_node_id,destination_node_id,direction,cost,status,resolved_at)
      VALUES(_request_id,_character_id,v_character.current_node_id,_destination_node_id,v_connection->>'direction',v_cost,'moved',now());
    PERFORM set_config('app.combat2_depart_authorized','true',true);
    UPDATE public.characters SET current_node_id=_destination_node_id,mp=mp-v_cost
      WHERE id=_character_id AND current_node_id=v_character.current_node_id AND hp>0 AND mp>=v_cost;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='combat2_depart_fence_failed'; END IF;
    RETURN jsonb_build_object('ok',true,'kind','moved','request_id',_request_id,
      'origin_node_id',v_character.current_node_id,'destination_node_id',_destination_node_id,'cost',v_cost,'resource_kind','mp');
  END IF;

  IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','mode_refused','reason','maintenance'); END IF;
  IF v_fighter.exit_request_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','exit_pending'); END IF;
  INSERT INTO public.combat2_departure_request(request_id,character_id,origin_node_id,destination_node_id,
    direction,encounter_id,fighter_id,fighter_entry_seq,arrival_group_id,cost,status)
  VALUES(_request_id,_character_id,v_character.current_node_id,_destination_node_id,v_connection->>'direction',v_encounter.id,
    v_fighter.id,v_fighter.entry_seq,v_fighter.arrival_group_id,v_cost,'queued');
  INSERT INTO public.node_pending_event(encounter_id,event_type,actor_character_id,payload,request_id)
  VALUES(v_encounter.id,'fighter_depart_requested',_character_id,jsonb_build_object(
    'departure_request_id',_request_id,'fighter_id',v_fighter.id,'entry_seq',v_fighter.entry_seq,
    'arrival_group_id',v_fighter.arrival_group_id,'origin_node_id',v_character.current_node_id,
    'destination_node_id',_destination_node_id,'cost',v_cost,'resource_kind','mp'),_request_id)
  RETURNING id INTO v_event;
  UPDATE public.node_fighter SET exit_request_id=v_event,updated_at=now() WHERE id=v_fighter.id;
  UPDATE public.node_intent SET status='rejected',reject_reason='exit_pending'
    WHERE encounter_id=v_encounter.id AND character_id=_character_id AND status='pending';
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
    claim_expires_at=NULL,next_due_at=LEAST(next_due_at,now()),updated_at=now()
    WHERE id=v_encounter.id RETURNING state_version INTO v_version;
  RETURN jsonb_build_object('ok',true,'kind','queued','request_id',_request_id,'event_id',v_event,
    'origin_node_id',v_character.current_node_id,'destination_node_id',_destination_node_id,
    'cost',v_cost,'resource_kind','mp','state_version',v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_depart(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat2_depart(uuid,uuid,uuid) TO authenticated, service_role;

-- Extend the installed atomic commit with pre-mutation departure fencing and
-- same-transaction movement/cost persistence. Fail installation on contract drift.
DO $migration$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure) INTO d;
  IF position('-- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------' in d)=0
     OR position('UPDATE public.node_encounter' in d)=0 THEN
    RAISE EXCEPTION 'unexpected node_tick_commit contract';
  END IF;
  d := replace(d,
    '  -- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------',
    $insert$
  -- departure proposals are locked and fully fenced before any mutation.
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) LOOP
    PERFORM 1 FROM public.combat2_departure_request dr
     WHERE dr.request_id=(rec->>'request_id')::uuid AND dr.status='queued'
       AND dr.encounter_id=_encounter_id AND dr.fighter_id=(rec->>'fighter_id')::uuid
       AND dr.fighter_entry_seq=(rec->>'fighter_entry_seq')::bigint
       AND dr.origin_node_id=(rec->>'origin_node_id')::uuid
       AND dr.destination_node_id=(rec->>'destination_node_id')::uuid
       AND dr.cost=(rec->>'cost')::integer AND dr.resource_kind='mp'
     FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.node_fighter nf JOIN public.characters c ON c.id=nf.character_id
       WHERE nf.id=(rec->>'fighter_id')::uuid AND nf.encounter_id=_encounter_id
         AND nf.entry_seq=(rec->>'fighter_entry_seq')::bigint AND nf.present
         AND nf.arrival_group_id IS NOT DISTINCT FROM (
           SELECT dr.arrival_group_id FROM public.combat2_departure_request dr
            WHERE dr.request_id=(rec->>'request_id')::uuid)
         AND c.current_node_id=(rec->>'origin_node_id')::uuid
    ) THEN RETURN jsonb_build_object('ok',false,'kind','stale_departure'); END IF;
    IF rec->>'outcome' NOT IN ('moved','dead') THEN
      RETURN jsonb_build_object('ok',false,'kind','malformed_departure');
    END IF;
  END LOOP;

  -- ---------- mutations (all WHERE clauses re-scoped to the encounter) ----------$insert$);
  IF position('departure proposals are locked and fully fenced' in d)=0 THEN
    RAISE EXCEPTION 'node_tick_commit validation patch failed';
  END IF;
  d := replace(d,
    '  UPDATE public.node_encounter' || chr(10) || '     SET tick',
    $insert$
  FOR rec IN SELECT * FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) LOOP
    IF rec->>'outcome'='moved' THEN
      PERFORM set_config('app.combat2_depart_authorized','true',true);
      UPDATE public.characters SET current_node_id=(rec->>'destination_node_id')::uuid,
        mp=mp-(rec->>'cost')::integer
       WHERE id=(SELECT character_id FROM public.combat2_departure_request WHERE request_id=(rec->>'request_id')::uuid)
         AND current_node_id=(rec->>'origin_node_id')::uuid AND hp>0 AND mp>=(rec->>'cost')::integer;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='combat2_depart_fence_failed'; END IF;
      UPDATE public.combat2_departure_request SET status='moved',resolved_tick=_candidate_tick,resolved_at=now()
       WHERE request_id=(rec->>'request_id')::uuid AND status='queued';
    ELSE
      UPDATE public.combat2_departure_request SET status='dead',resolved_tick=_candidate_tick,resolved_at=now()
       WHERE request_id=(rec->>'request_id')::uuid AND status='queued';
    END IF;
  END LOOP;

  UPDATE public.node_encounter
     SET tick$insert$);
  IF position('combat2_depart_fence_failed' in d)=0 THEN
    RAISE EXCEPTION 'node_tick_commit persistence patch failed';
  END IF;
  EXECUTE d;
END
$migration$;