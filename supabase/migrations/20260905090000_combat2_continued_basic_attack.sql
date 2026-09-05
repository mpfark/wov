-- Server-owned, spawn-fenced Combat2 continued basic attacks.
ALTER TABLE public.node_intent DROP CONSTRAINT IF EXISTS node_intent_kind_chk;
ALTER TABLE public.node_intent ADD CONSTRAINT node_intent_kind_chk
  CHECK (intent_kind IN ('ability','stance_activate','stance_drop','basic_attack'));
ALTER TABLE public.node_intent DROP CONSTRAINT IF EXISTS node_intent_shape_chk;
ALTER TABLE public.node_intent ADD CONSTRAINT node_intent_shape_chk CHECK (
  (intent_kind='ability' AND ability_key IS NOT NULL AND stance_key IS NULL) OR
  (intent_kind IN ('stance_activate','stance_drop') AND ability_key IS NULL AND stance_key IS NOT NULL AND target_creature_id IS NULL) OR
  (intent_kind='basic_attack' AND ability_key IS NULL AND stance_key IS NULL AND target_creature_id IS NOT NULL)
);

ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid)
  RENAME TO combat_intent_without_basic_attack;
REVOKE ALL ON FUNCTION public.combat_intent_without_basic_attack(uuid,uuid,text,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.combat_intent_without_basic_attack(uuid,uuid,text,text,text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.combat_intent(
  _encounter_id uuid, _character_id uuid, _intent_kind text, _ability_key text,
  _stance_key text, _target_creature_id uuid, _request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.node_encounter; f public.node_fighter; prior public.node_intent;
  target public.node_creature; v_id uuid; v_seq bigint; v_version bigint;
BEGIN
  IF _intent_kind <> 'basic_attack' THEN
    RETURN public.combat_intent_without_basic_attack(_encounter_id,_character_id,_intent_kind,
      _ability_key,_stance_key,_target_creature_id,_request_id);
  END IF;
  IF NOT public.combat_mode_is_open() THEN RETURN jsonb_build_object('ok',false,'kind','mode_refused','reason','maintenance'); END IF;
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_required'); END IF;
  IF _ability_key IS NOT NULL OR _stance_key IS NOT NULL OR _target_creature_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','shape_basic_attack');
  END IF;
  IF NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized','reason','character'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_intent:'||_character_id::text,0));
  SELECT * INTO prior FROM public.node_intent WHERE request_id=_request_id;
  IF FOUND THEN
    IF prior.character_id<>_character_id OR prior.intent_kind<>'basic_attack' OR prior.encounter_id<>_encounter_id
       OR prior.target_creature_id<>_target_creature_id THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'kind','already_queued','intent_id',prior.id,'seq',prior.seq,'status',prior.status);
  END IF;
  SELECT * INTO e FROM public.node_encounter WHERE id=_encounter_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','no_encounter'); END IF;
  IF e.status<>'active' THEN RETURN jsonb_build_object('ok',false,'kind','not_accepting_input','reason',e.status); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.current_node_id=e.node_id)
    THEN RETURN jsonb_build_object('ok',false,'kind','not_at_node'); END IF;
  SELECT * INTO f FROM public.node_fighter WHERE encounter_id=e.id AND character_id=_character_id FOR UPDATE;
  IF NOT FOUND OR NOT f.present THEN RETURN jsonb_build_object('ok',false,'kind','not_present'); END IF;
  IF f.exit_request_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'kind','exit_pending'); END IF;
  SELECT * INTO target FROM public.node_creature WHERE encounter_id=e.id AND creature_id=_target_creature_id AND is_alive FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','invalid_target','reason','not_in_encounter_or_dead'); END IF;
  -- All validation precedes replacement, so an invalid request preserves the prior pending action.
  UPDATE public.node_intent SET status='rejected',reject_reason='superseded'
    WHERE character_id=_character_id AND status='pending';
  DELETE FROM public.node_effect WHERE encounter_id=e.id AND kind='autoattack' AND target_character_id=_character_id;
  INSERT INTO public.node_effect(encounter_id,kind,effect_type,target_character_id,target_creature_id,
    source_character_id,stacks,magnitude,config,is_reservation)
  VALUES(e.id,'autoattack','basic_attack',_character_id,target.creature_id,_character_id,1,0,
    jsonb_build_object('node_creature_id',target.id,'spawn_seq',target.spawn_seq),false);
  INSERT INTO public.node_intent(encounter_id,character_id,intent_kind,ability_key,stance_key,target_creature_id,status,request_id)
    VALUES(e.id,_character_id,'basic_attack',NULL,NULL,target.creature_id,'pending',_request_id)
    RETURNING id,seq INTO v_id,v_seq;
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
    claim_expires_at=NULL,intent_cutoff_seq=NULL,updated_at=now() WHERE id=e.id RETURNING state_version INTO v_version;
  RETURN jsonb_build_object('ok',true,'kind','queued','intent_id',v_id,'seq',v_seq,'status','pending','state_version',v_version);
END $$;
REVOKE ALL ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid) TO authenticated,service_role;

ALTER FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) RENAME TO combat2_sync_without_autoattack;
REVOKE ALL ON FUNCTION public.combat2_sync_without_autoattack(uuid,uuid,bigint,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_sync_without_autoattack(uuid,uuid,bigint,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.combat2_sync(_character_id uuid,_encounter_id uuid,
  _after_tick bigint DEFAULT 0,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; active jsonb;
BEGIN
  result := public.combat2_sync_without_autoattack(_character_id,_encounter_id,_after_tick,_limit);
  IF COALESCE((result->>'ok')::boolean,false) IS NOT TRUE THEN RETURN result; END IF;
  SELECT jsonb_build_object('targetCreatureId',ne.target_creature_id,'nodeCreatureId',nc.id,
    'spawnSeq',nc.spawn_seq,'active',nc.is_alive AND nf.present AND nf.exit_request_id IS NULL)
  INTO active FROM public.node_effect ne
  JOIN public.node_fighter nf ON nf.encounter_id=ne.encounter_id AND nf.character_id=_character_id
  JOIN public.node_creature nc ON nc.encounter_id=ne.encounter_id AND nc.creature_id=ne.target_creature_id
    AND nc.id=(ne.config->>'node_creature_id')::uuid AND nc.spawn_seq=(ne.config->>'spawn_seq')::bigint
  WHERE ne.encounter_id=_encounter_id AND ne.kind='autoattack' AND ne.target_character_id=_character_id LIMIT 1;
  RETURN jsonb_set(result,'{autoattack}',COALESCE(active,'null'::jsonb),true);
END $$;
REVOKE ALL ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) TO authenticated,service_role;
