-- Fence stale work when reactivating an existing Combat2 encounter and fail
-- closed if a character has more than one accepted party membership.
CREATE OR REPLACE FUNCTION public.combat_enter(_character_id uuid, _request_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prior public.node_pending_event; e public.node_encounter; f public.node_fighter;
  v_node uuid; v_check uuid; v_party uuid; v_group uuid; v_fighter uuid;
  v_seq bigint; v_generation bigint; v_event uuid; v_version bigint;
  v_parties uuid[];
  v_reentry boolean := false; v_reactivated boolean := false;
BEGIN
  IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','mode_refused','reason','maintenance'); END IF;
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_required'); END IF;
  IF NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized','reason','character'); END IF;
  SELECT * INTO prior FROM public.node_pending_event WHERE request_id = _request_id;
  IF FOUND THEN
    IF prior.actor_character_id IS DISTINCT FROM _character_id OR prior.event_type <> 'fighter_entered' THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'kind','already_entered','encounter_id',prior.encounter_id,
      'event_id',prior.id,'fighter_id',prior.payload->>'fighter_id','entry_seq',(prior.payload->>'entry_seq')::bigint);
  END IF;
  SELECT current_node_id INTO v_node FROM public.characters WHERE id = _character_id;
  IF v_node IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','no_node'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:' || v_node::text,0));
  SELECT current_node_id INTO v_check FROM public.characters WHERE id = _character_id;
  IF v_check IS DISTINCT FROM v_node THEN RETURN jsonb_build_object('ok',false,'kind','node_changed'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creatures WHERE node_id=v_node AND is_alive) THEN
    RETURN jsonb_build_object('ok',false,'kind','no_living_creatures');
  END IF;
  SELECT array_agg(pm.party_id) INTO v_parties FROM public.party_members pm
    WHERE pm.character_id=_character_id AND pm.status='accepted';
  IF cardinality(v_parties) > 1 THEN
    RETURN jsonb_build_object('ok',false,'kind','ambiguous_party_membership');
  END IF;
  v_party := v_parties[1];
  SELECT * INTO e FROM public.node_encounter WHERE node_id=v_node FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.node_encounter(node_id,status,next_due_at) VALUES(v_node,'active',now()) RETURNING * INTO e;
  ELSIF e.status <> 'active' THEN
    v_reactivated := true;
    UPDATE public.node_fighter SET present=false,left_at=COALESCE(left_at,now()),updated_at=now() WHERE encounter_id=e.id AND present;
    UPDATE public.node_arrival_group SET active=false,deactivated_at=now() WHERE encounter_id=e.id AND active;
    UPDATE public.node_creature SET tank_fighter_id=NULL,engaged=false,updated_at=now() WHERE encounter_id=e.id AND is_alive;
    UPDATE public.node_intent SET status='rejected',reject_reason='stale_generation'
      WHERE encounter_id=e.id AND status='pending';
    UPDATE public.node_pending_event SET consumed_at=now(),consumed_tick=e.tick
      WHERE encounter_id=e.id AND consumed_at IS NULL;
    UPDATE public.node_encounter SET status='active',next_due_at=now(),claim_token=NULL,claimed_tick=NULL,
      claim_expires_at=NULL,intent_cutoff_seq=NULL,updated_at=now() WHERE id=e.id RETURNING * INTO e;
  END IF;
  PERFORM public.combat2_seed_spawns(e.id, v_node);
  IF v_party IS NULL THEN
    SELECT COALESCE(MAX(g.generation),0)+1 INTO v_generation FROM public.node_arrival_group g
      WHERE g.encounter_id=e.id AND g.party_id IS NULL;
    INSERT INTO public.node_arrival_group(encounter_id,party_id,generation)
      VALUES(e.id,NULL,v_generation) RETURNING id INTO v_group;
  ELSE
    SELECT g.id INTO v_group FROM public.node_arrival_group g
      WHERE g.encounter_id=e.id AND g.party_id=v_party AND g.active LIMIT 1;
    IF v_group IS NULL THEN
      SELECT COALESCE(MAX(g.generation),0)+1 INTO v_generation FROM public.node_arrival_group g
        WHERE g.encounter_id=e.id AND g.party_id=v_party;
      INSERT INTO public.node_arrival_group(encounter_id,party_id,generation)
        VALUES(e.id,v_party,v_generation) RETURNING id INTO v_group;
    END IF;
  END IF;
  SELECT nf.* INTO f FROM public.node_fighter nf WHERE nf.encounter_id=e.id AND nf.character_id=_character_id FOR UPDATE;
  IF FOUND AND f.present THEN
    RETURN jsonb_build_object('ok',false,'kind','already_present','encounter_id',e.id,'fighter_id',f.id,'entry_seq',f.entry_seq);
  END IF;
  v_seq := nextval('node_fighter_entry_seq_seq');
  IF FOUND THEN
    v_reentry := true;
    UPDATE public.node_fighter SET present=true,left_at=NULL,entry_seq=v_seq,joined_at=now(),party_id_at_entry=v_party,
      arrival_group_id=v_group,exit_request_id=NULL,updated_at=now() WHERE id=f.id RETURNING id INTO v_fighter;
  ELSE
    INSERT INTO public.node_fighter(encounter_id,character_id,entry_seq,present,party_id_at_entry,joined_at,arrival_group_id)
      VALUES(e.id,_character_id,v_seq,true,v_party,now(),v_group) RETURNING id INTO v_fighter;
  END IF;
  UPDATE public.node_creature nc SET engaged=true,updated_at=now()
    FROM public.creatures cr WHERE nc.encounter_id=e.id AND nc.creature_id=cr.id AND nc.is_alive
      AND cr.is_aggressive=true AND NOT nc.engaged;
  PERFORM public.combat2_refresh_tanks(e.id);
  INSERT INTO public.node_pending_event(encounter_id,event_type,actor_character_id,payload,request_id)
    VALUES(e.id,'fighter_entered',_character_id,jsonb_build_object('fighter_id',v_fighter,'node_id',v_node,
      'entry_seq',v_seq,'arrival_group_id',v_group,'reentry',v_reentry,'reactivated',v_reactivated),_request_id)
    RETURNING id INTO v_event;
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
    claim_expires_at=NULL,updated_at=now() WHERE id=e.id RETURNING state_version INTO v_version;
  RETURN jsonb_build_object('ok',true,'kind',CASE WHEN v_reentry THEN 'reentered' ELSE 'entered' END,
    'encounter_id',e.id,'node_id',v_node,'reactivated',v_reactivated,'fighter_id',v_fighter,
    'entry_seq',v_seq,'event_id',v_event,'state_version',v_version);
END;
$$;

REVOKE ALL ON FUNCTION public.combat_enter(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combat_enter(uuid,uuid) TO authenticated, service_role;