-- ENG-MOVE-001: finish ordinary Combat2 relocation in the caller transaction.
-- The installed predecessors remain the sole owners of movement validation,
-- cost calculation, party inclusion, and durable request creation.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.combat2_depart(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_party_depart(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat_flee(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_refresh_tanks(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ENG-MOVE-001 predecessor contract is incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_encounter' AND column_name='claim_expires_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_pending_event' AND column_name='consumed_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_pending_event' AND column_name='consumed_tick')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_intent' AND column_name='target_character_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_effect' AND column_name='target_character_id') THEN
    RAISE EXCEPTION 'ENG-MOVE-001 installed schema drift';
  END IF;
END
$guard$;

-- A captured lease is fenced by the same encounter lock/version transition; it
-- is not a reason to preserve the old wait. Patch only the installed inner
-- party validator and fail closed if its exact predecessor contract drifted.
DO $party_claim_fence$
DECLARE definition text; needle text;
BEGIN
  needle := ' IF encounter.claim_token IS NOT NULL AND encounter.claim_expires_at>now() THEN RETURN jsonb_build_object(''ok'',false,''kind'',''live_claim''); END IF;';
  SELECT pg_get_functiondef('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(needle in definition)=0 THEN RAISE EXCEPTION 'ENG-MOVE-001 party claim predecessor drift'; END IF;
  definition := replace(definition,needle,' -- ENG-MOVE-001: the immediate owner fences the captured claim below.');
  EXECUTE definition;
END
$party_claim_fence$;

-- This function performs no combat resolution. Lock order after the public
-- node locks is encounter -> character -> fighter/effects/request state.
CREATE FUNCTION public.combat2_finish_immediate_departure(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  d public.combat2_departure_request;
  e public.node_encounter;
  c public.characters;
  f public.node_fighter;
BEGIN
  SELECT * INTO d FROM public.combat2_departure_request WHERE request_id=_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','departure_not_found'); END IF;
  IF d.status='moved' THEN
    RETURN jsonb_build_object('ok',true,'kind','already_moved','request_id',d.request_id,
      'origin_node_id',d.origin_node_id,'destination_node_id',d.destination_node_id,
      'cost',d.cost,'resource_kind',d.resource_kind);
  ELSIF d.status='dead' THEN
    RETURN jsonb_build_object('ok',false,'kind','dead');
  END IF;

  SELECT * INTO e FROM public.node_encounter WHERE id=d.encounter_id FOR UPDATE;
  SELECT * INTO c FROM public.characters WHERE id=d.character_id FOR UPDATE;
  SELECT * INTO f FROM public.node_fighter WHERE id=d.fighter_id FOR UPDATE;
  SELECT * INTO d FROM public.combat2_departure_request WHERE request_id=_request_id FOR UPDATE;
  IF d.status='moved' THEN
    RETURN jsonb_build_object('ok',true,'kind','already_moved','request_id',d.request_id,
      'origin_node_id',d.origin_node_id,'destination_node_id',d.destination_node_id,
      'cost',d.cost,'resource_kind',d.resource_kind);
  ELSIF d.status='dead' THEN
    RETURN jsonb_build_object('ok',false,'kind','dead');
  END IF;
  IF c.id IS NULL OR c.hp<=0 THEN
    UPDATE public.combat2_departure_request SET status='dead',resolved_tick=e.tick,resolved_at=clock_timestamp()
      WHERE request_id=d.request_id AND status='queued';
    RETURN jsonb_build_object('ok',false,'kind','dead');
  END IF;
  IF e.id IS NULL OR e.status<>'active' OR c.current_node_id IS DISTINCT FROM d.origin_node_id
     OR f.id IS NULL OR NOT f.present OR f.encounter_id IS DISTINCT FROM d.encounter_id
     OR f.entry_seq IS DISTINCT FROM d.fighter_entry_seq THEN
    RETURN jsonb_build_object('ok',false,'kind','stale_departure');
  END IF;

  -- Fence every origin-side commit before changing participation.
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,
    claimed_tick=NULL,claim_expires_at=NULL,intent_cutoff_seq=NULL,updated_at=clock_timestamp()
    WHERE id=e.id;
  UPDATE public.node_intent SET status='rejected',reject_reason='departed'
    WHERE encounter_id=e.id AND status='pending'
      AND (character_id=d.character_id OR target_character_id=d.character_id);
  UPDATE public.node_pending_event SET consumed_at=clock_timestamp(),consumed_tick=e.tick
    WHERE encounter_id=e.id AND request_id=d.request_id
      AND event_type='fighter_depart_requested' AND consumed_at IS NULL;

  -- Character-targeted encounter state (including autoattack and stance
  -- reservations) cannot follow the fighter. Creature-targeted effects sourced
  -- by the character intentionally remain processable offscreen.
  DELETE FROM public.node_effect
    WHERE encounter_id=e.id AND target_character_id=d.character_id;
  UPDATE public.node_fighter SET present=false,left_at=COALESCE(left_at,clock_timestamp()),
    exit_request_id=NULL,updated_at=clock_timestamp()
    WHERE id=f.id AND present;
  PERFORM public.combat2_refresh_tanks(e.id);

  PERFORM set_config('app.combat2_depart_authorized','true',true);
  UPDATE public.characters SET current_node_id=d.destination_node_id,mp=mp-d.cost
    WHERE id=d.character_id AND current_node_id=d.origin_node_id AND hp>0 AND mp>=d.cost;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='combat2_immediate_depart_fence_failed'; END IF;
  UPDATE public.combat2_departure_request SET status='moved',resolved_tick=e.tick,resolved_at=clock_timestamp()
    WHERE request_id=d.request_id AND status='queued';
  RETURN jsonb_build_object('ok',true,'kind','moved','request_id',d.request_id,
    'origin_node_id',d.origin_node_id,'destination_node_id',d.destination_node_id,
    'cost',d.cost,'resource_kind',d.resource_kind);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_finish_immediate_departure(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_finish_immediate_departure(uuid) TO service_role;

ALTER FUNCTION public.combat2_depart(uuid,uuid,uuid) RENAME TO combat2_depart_without_immediate_transition;
REVOKE ALL ON FUNCTION public.combat2_depart_without_immediate_transition(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_depart_without_immediate_transition(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.combat2_depart(_character_id uuid,_destination_node_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  result:=public.combat2_depart_without_immediate_transition(_character_id,_destination_node_id,_request_id);
  IF result->>'ok'='true' AND result->>'kind' IN('queued','already_queued') THEN
    RETURN public.combat2_finish_immediate_departure(_request_id);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_depart(uuid,uuid,uuid) TO authenticated,service_role;

-- The legacy trigger moved waiting party members after the final worker-owned
-- child completed. Immediate party movement has one explicit ordered owner.
DROP TRIGGER IF EXISTS combat2_party_departure_member_finalized ON public.combat2_departure_request;

CREATE FUNCTION public.combat2_finish_immediate_party_departure(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.combat2_party_departure_request; m public.combat2_party_departure_member;
  outcome jsonb; outcomes jsonb;
BEGIN
  SELECT * INTO r FROM public.combat2_party_departure_request WHERE request_id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','departure_not_found'); END IF;
  IF r.status='completed' THEN RETURN public.combat2_party_departure_result(_request_id); END IF;
  FOR m IN SELECT * FROM public.combat2_party_departure_member WHERE request_id=_request_id ORDER BY movement_order FOR UPDATE LOOP
    IF m.status='queued' THEN
      outcome:=public.combat2_finish_immediate_departure(m.departure_request_id);
      IF outcome->>'ok'<>'true' THEN RAISE EXCEPTION 'combat2_party_immediate_depart_failed: %',outcome->>'kind'; END IF;
    ELSE
      PERFORM set_config('app.combat2_depart_authorized','true',true);
      UPDATE public.characters SET current_node_id=r.destination_node_id,mp=mp-m.cost
        WHERE id=m.character_id AND current_node_id=r.origin_node_id AND hp>0 AND mp>=m.cost;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='combat2_party_immediate_depart_fence_failed'; END IF;
    END IF;
    UPDATE public.combat2_party_departure_member SET status='moved',resolved_at=clock_timestamp()
      WHERE request_id=_request_id AND character_id=m.character_id;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('character_id',character_id,'display_name',display_name,
    'order',movement_order,'status',status,'cost',cost) ORDER BY movement_order)
    INTO outcomes FROM public.combat2_party_departure_member WHERE request_id=_request_id;
  UPDATE public.combat2_party_departure_request SET status='completed',result=outcomes,resolved_at=clock_timestamp()
    WHERE request_id=_request_id;
  RETURN jsonb_build_object('ok',true,'kind','moved','request_id',_request_id,
    'origin_node_id',r.origin_node_id,'destination_node_id',r.destination_node_id,
    'cost',0,'resource_kind','mp','members',outcomes);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_finish_immediate_party_departure(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_finish_immediate_party_departure(uuid) TO service_role;

ALTER FUNCTION public.combat2_party_depart(uuid,uuid,uuid) RENAME TO combat2_party_depart_without_immediate_transition;
REVOKE ALL ON FUNCTION public.combat2_party_depart_without_immediate_transition(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart_without_immediate_transition(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.combat2_party_depart(_leader_character_id uuid,_destination_node_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  result:=public.combat2_party_depart_without_immediate_transition(_leader_character_id,_destination_node_id,_request_id);
  IF result->>'ok'='true' AND result->>'kind' IN('queued','already_queued') THEN
    RETURN public.combat2_finish_immediate_party_departure(_request_id);
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role;

-- combat_flee has no destination and therefore cannot express an atomic
-- relocation. Keep its signature as an explicit compatibility refusal; every
-- browser movement surface already routes through combat2_depart.
CREATE OR REPLACE FUNCTION public.combat_flee(_encounter_id uuid,_character_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('ok',false,'kind','destination_required',
    'reason','Use combat2_depart with an authoritative adjacent destination');
$$;
REVOKE ALL ON FUNCTION public.combat_flee(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_flee(uuid,uuid,uuid) TO authenticated,service_role;

COMMIT;
