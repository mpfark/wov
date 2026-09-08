-- Authoritative lifecycle for the existing real parties and party_members model.
CREATE TABLE public.party_operation_request (
 request_id uuid PRIMARY KEY, caller_id uuid NOT NULL, actor_character_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN('create','invite','accept','decline','cancel','leave','kick','disband','set_tank')),
 party_id uuid, target_character_id uuid, membership_id uuid, result jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.party_operation_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.party_operation_request FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.party_operation_request TO service_role;

CREATE OR REPLACE FUNCTION public.party_operation_finish(_request_id uuid,_result jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN UPDATE public.party_operation_request SET result=_result WHERE request_id=_request_id; RETURN _result; END $$;
REVOKE ALL ON FUNCTION public.party_operation_finish(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.party_operation_finish(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.party_combat_mutation_blocked(_party_id uuid,_extra_character_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH affected AS (
  SELECT character_id FROM public.party_members WHERE party_id=_party_id AND status='accepted'
  UNION SELECT _extra_character_id WHERE _extra_character_id IS NOT NULL
 ), active_fighters AS (
  SELECT nf.encounter_id,nf.character_id FROM public.node_fighter nf JOIN public.node_encounter e ON e.id=nf.encounter_id
  WHERE nf.present AND e.status='active' AND nf.character_id IN(SELECT character_id FROM affected)
 ) SELECT EXISTS(SELECT 1 FROM active_fighters)
   OR EXISTS(SELECT 1 FROM public.combat2_departure_request d WHERE d.status='pending' AND d.character_id IN(SELECT character_id FROM affected))
   OR EXISTS(SELECT 1 FROM public.node_fighter nf JOIN public.node_encounter e ON e.id=nf.encounter_id
      WHERE nf.character_id IN(SELECT character_id FROM affected) AND e.status='active'
        AND e.claim_token IS NOT NULL AND e.claim_expires_at>now());
$$;
REVOKE ALL ON FUNCTION public.party_combat_mutation_blocked(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.party_combat_mutation_blocked(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.party_mutate(
 _actor_character_id uuid,_operation text,_party_id uuid,_target_character_id uuid,_membership_id uuid,_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); prior public.party_operation_request; actor public.characters; p public.parties;
 member public.party_members; created_party uuid; result jsonb; member_count integer;
BEGIN
 IF caller IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF _request_id IS NULL OR _actor_character_id IS NULL OR _operation IS NULL
  THEN RETURN jsonb_build_object('ok',false,'kind','invalid_shape'); END IF;
 -- Global order: lifecycle advisory lock, request row, actor row, party row, membership rows.
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 SELECT * INTO prior FROM public.party_operation_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.caller_id IS DISTINCT FROM caller OR prior.actor_character_id<>_actor_character_id OR prior.operation<>_operation
   OR prior.party_id IS DISTINCT FROM _party_id OR prior.target_character_id IS DISTINCT FROM _target_character_id
   OR prior.membership_id IS DISTINCT FROM _membership_id THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN COALESCE(prior.result,jsonb_build_object('ok',false,'kind','request_in_progress'));
 END IF;
 IF _operation NOT IN('create','invite','accept','decline','cancel','leave','kick','disband','set_tank')
  THEN RETURN jsonb_build_object('ok',false,'kind','unknown_operation'); END IF;
 INSERT INTO public.party_operation_request(request_id,caller_id,actor_character_id,operation,party_id,target_character_id,membership_id)
  VALUES(_request_id,caller,_actor_character_id,_operation,_party_id,_target_character_id,_membership_id);
 SELECT * INTO actor FROM public.characters WHERE id=_actor_character_id AND user_id=caller FOR UPDATE;
 IF NOT FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','not_authorized')); END IF;
 IF actor.hp<=0 THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','actor_dead')); END IF;

 IF _operation='create' THEN
  IF _party_id IS NOT NULL OR _target_character_id IS NOT NULL OR _membership_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF EXISTS(SELECT 1 FROM public.party_members WHERE character_id=actor.id AND status='accepted') OR EXISTS(SELECT 1 FROM public.parties WHERE leader_id=actor.id)
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','already_in_party')); END IF;
  INSERT INTO public.parties(leader_id,tank_id) VALUES(actor.id,actor.id) RETURNING id INTO created_party;
  INSERT INTO public.party_members(party_id,character_id,status,is_following) VALUES(created_party,actor.id,'accepted',false);
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','party_created','party_id',created_party));
 END IF;

 IF _operation='accept' THEN
  IF _membership_id IS NULL OR _party_id IS NOT NULL OR _target_character_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  SELECT * INTO member FROM public.party_members WHERE id=_membership_id AND character_id=actor.id FOR UPDATE;
  IF NOT FOUND OR member.status<>'pending' THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invitation_not_active')); END IF;
  IF EXISTS(SELECT 1 FROM public.party_members WHERE character_id=actor.id AND status='accepted')
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','already_in_party')); END IF;
  IF public.party_combat_mutation_blocked(member.party_id,actor.id)
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','combat_active')); END IF;
  UPDATE public.party_members SET status='accepted',joined_at=now(),is_following=false WHERE id=member.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','invitation_accepted','party_id',member.party_id));
 END IF;

 IF _operation='decline' THEN
  IF _membership_id IS NULL OR _party_id IS NOT NULL OR _target_character_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  SELECT * INTO member FROM public.party_members WHERE id=_membership_id AND character_id=actor.id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','invitation_already_closed')); END IF;
  DELETE FROM public.party_members WHERE id=member.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','invitation_declined'));
 END IF;

 SELECT * INTO p FROM public.parties WHERE id=_party_id FOR UPDATE;
 IF NOT FOUND THEN
  IF _operation='disband' THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','party_already_disbanded')); END IF;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','party_not_found'));
 END IF;

 IF _operation='invite' THEN
  IF _party_id IS NULL OR _target_character_id IS NULL OR _membership_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF p.leader_id<>actor.id THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','leader_required')); END IF;
  IF _target_character_id IS NULL OR _target_character_id=actor.id OR NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_target_character_id AND c.hp>0 AND c.current_node_id=actor.current_node_id)
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','target_not_available')); END IF;
  IF EXISTS(SELECT 1 FROM public.party_members WHERE character_id=_target_character_id AND status='accepted')
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','target_already_in_party')); END IF;
  SELECT * INTO member FROM public.party_members WHERE party_id=p.id AND character_id=_target_character_id AND status='pending';
  IF FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','already_invited','membership_id',member.id)); END IF;
  SELECT count(*) INTO member_count FROM public.party_members WHERE party_id=p.id;
  IF member_count>=4 THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','party_full')); END IF;
  INSERT INTO public.party_members(party_id,character_id,status,is_following) VALUES(p.id,_target_character_id,'pending',false) RETURNING * INTO member;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','invited','membership_id',member.id));
 END IF;

 IF _operation='cancel' THEN
  IF _party_id IS NULL OR _membership_id IS NULL OR _target_character_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF p.leader_id<>actor.id THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','leader_required')); END IF;
  SELECT * INTO member FROM public.party_members WHERE id=_membership_id AND party_id=p.id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','invitation_already_closed')); END IF;
  DELETE FROM public.party_members WHERE id=member.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','invitation_cancelled'));
 END IF;

 IF public.party_combat_mutation_blocked(p.id,NULL)
  THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','combat_active')); END IF;
 IF _operation='leave' THEN
  IF _target_character_id IS NOT NULL OR _membership_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF p.leader_id=actor.id THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','leader_must_disband')); END IF;
  SELECT * INTO member FROM public.party_members WHERE party_id=p.id AND character_id=actor.id AND status='accepted' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','already_left')); END IF;
  IF p.tank_id=actor.id THEN UPDATE public.parties SET tank_id=NULL WHERE id=p.id; END IF;
  DELETE FROM public.party_members WHERE id=member.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','party_left'));
 END IF;
 IF p.leader_id<>actor.id THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','leader_required')); END IF;
 IF _operation='kick' THEN
  IF _membership_id IS NOT NULL THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF _target_character_id IS NULL OR _target_character_id=actor.id THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_target')); END IF;
  SELECT * INTO member FROM public.party_members WHERE party_id=p.id AND character_id=_target_character_id AND status='accepted' FOR UPDATE;
  IF NOT FOUND THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','member_already_absent')); END IF;
  IF p.tank_id=member.character_id THEN UPDATE public.parties SET tank_id=NULL WHERE id=p.id; END IF;
  DELETE FROM public.party_members WHERE id=member.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','member_kicked'));
 END IF;
 IF _operation='set_tank' THEN
  IF _membership_id IS NOT NULL THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  IF _target_character_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.party_members pm JOIN public.characters c ON c.id=pm.character_id
    WHERE pm.party_id=p.id AND pm.character_id=_target_character_id AND pm.status='accepted' AND c.hp>0)
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_tank')); END IF;
  UPDATE public.parties SET tank_id=_target_character_id WHERE id=p.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','tank_changed'));
 END IF;
 IF _operation='disband' THEN
  IF _target_character_id IS NOT NULL OR _membership_id IS NOT NULL
   THEN RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','invalid_shape')); END IF;
  DELETE FROM public.party_members WHERE party_id=p.id;
  DELETE FROM public.parties WHERE id=p.id;
  RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',true,'kind','party_disbanded'));
 END IF;
 RETURN public.party_operation_finish(_request_id,jsonb_build_object('ok',false,'kind','unknown_operation'));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','party_operation_failed');
END $$;
REVOKE ALL ON FUNCTION public.party_mutate(uuid,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.party_mutate(uuid,text,uuid,uuid,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.party_state(_character_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE accepted_parties uuid[]; selected_party uuid; p public.parties; members jsonb; incoming jsonb; outgoing jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters WHERE id=_character_id AND user_id=auth.uid())
  THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT array_agg(party_id ORDER BY party_id) INTO accepted_parties FROM public.party_members WHERE character_id=_character_id AND status='accepted';
 IF COALESCE(cardinality(accepted_parties),0)>1 THEN RETURN jsonb_build_object('ok',false,'kind','ambiguous_membership'); END IF;
 selected_party:=accepted_parties[1];
 IF selected_party IS NOT NULL THEN SELECT * INTO p FROM public.parties WHERE id=selected_party; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pm.id,'characterId',c.id,'status',pm.status,'isFollowing',pm.is_following,
  'character',jsonb_build_object('id',c.id,'name',c.name,'familyName',c.family_name,'gender',c.gender,'race',c.race,'class',c.class,
   'level',c.level,'hp',c.hp,'maxHp',c.max_hp,'currentNodeId',c.current_node_id,'dex',c.dex)) ORDER BY pm.joined_at,pm.id),'[]'::jsonb)
 INTO members FROM public.party_members pm JOIN public.characters c ON c.id=pm.character_id WHERE pm.party_id=selected_party AND pm.status='accepted';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pm.id,'partyId',pm.party_id,'leaderName',leader.name) ORDER BY pm.joined_at,pm.id),'[]'::jsonb)
 INTO incoming FROM public.party_members pm JOIN public.parties ip ON ip.id=pm.party_id JOIN public.characters leader ON leader.id=ip.leader_id
 WHERE pm.character_id=_character_id AND pm.status='pending';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pm.id,'partyId',pm.party_id,'characterId',target.id,'characterName',target.name) ORDER BY pm.joined_at,pm.id),'[]'::jsonb)
 INTO outgoing FROM public.party_members pm JOIN public.characters target ON target.id=pm.character_id
 WHERE pm.party_id=selected_party AND pm.status='pending' AND p.leader_id=_character_id;
 RETURN jsonb_build_object('ok',true,'kind','party_state','party',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id',p.id,'leaderId',p.leader_id,'tankId',p.tank_id,'createdAt',p.created_at) END,'members',members,'incomingInvitations',incoming,'outgoingInvitations',outgoing);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','party_state_failed');
END $$;
REVOKE ALL ON FUNCTION public.party_state(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.party_state(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.combat2_party_preflight(_character_id uuid,_node_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE memberships integer;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.user_id=auth.uid() AND c.current_node_id=_node_id AND c.hp>0)
  THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat_sessions WHERE character_id=_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','legacy_session_active'); END IF;
 SELECT count(*) INTO memberships FROM public.party_members WHERE character_id=_character_id AND status='accepted';
 IF memberships>1 THEN RETURN jsonb_build_object('ok',false,'kind','ambiguous_membership'); END IF;
 RETURN jsonb_build_object('ok',true,'kind','eligible','party_member',memberships=1);
END $$;
REVOKE ALL ON FUNCTION public.combat2_party_preflight(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_party_preflight(uuid,uuid) TO authenticated,service_role;

-- Remove obsolete browser mutation surfaces; table SELECT remains for authorized Realtime invalidation only.
DROP POLICY IF EXISTS "Anyone can view parties" ON public.parties;
DROP POLICY IF EXISTS "Anyone can view party members" ON public.party_members;
DROP POLICY IF EXISTS "Members can view own party" ON public.parties;
DROP POLICY IF EXISTS "Pending members can view party" ON public.parties;
DROP POLICY IF EXISTS "Members can view party members" ON public.party_members;
CREATE OR REPLACE FUNCTION public.party_can_view(_party_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.party_members pm JOIN public.characters c ON c.id=pm.character_id
  WHERE pm.party_id=_party_id AND c.user_id=auth.uid()
 );
$$;
REVOKE ALL ON FUNCTION public.party_can_view(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.party_can_view(uuid) TO authenticated,service_role;
CREATE POLICY "Party participants can view parties" ON public.parties FOR SELECT TO authenticated USING (
 public.party_can_view(id)
);
CREATE POLICY "Party participants can view memberships" ON public.party_members FOR SELECT TO authenticated USING (
 public.party_can_view(party_id)
);
REVOKE INSERT,UPDATE,DELETE ON public.parties,public.party_members FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accept_party_invite(uuid) FROM authenticated,anon,PUBLIC;
REVOKE ALL ON FUNCTION public.set_party_tank(uuid,uuid) FROM authenticated,anon,PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_party_invite(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_party_tank(uuid,uuid) TO service_role;

-- Retain the proven final-ability safe-report and generation-fenced ally projection.
CREATE OR REPLACE FUNCTION public.combat2_test_safe_event(_event jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('seq',_event->'seq','kind',_event->'kind',
 'actor',CASE WHEN jsonb_typeof(_event->'actor')='object' THEN jsonb_strip_nulls(jsonb_build_object('type',_event#>>'{actor,type}','id',_event#>>'{actor,id}','name',_event#>>'{actor,name}')) END,
 'target',CASE WHEN jsonb_typeof(_event->'target')='object' THEN jsonb_strip_nulls(jsonb_build_object('type',_event#>>'{target,type}','id',_event#>>'{target,id}','name',_event#>>'{target,name}')) END,
 'abilityKey',_event->'abilityKey','amount',_event->'amount','hitQuality',_event->'hitQuality','outcomeReason',_event->'outcomeReason','eventType',_event->'eventType',
 'actorCharacterId',_event->'actorCharacterId','actorCreatureId',_event->'actorCreatureId','targetCharacterId',_event->'targetCharacterId','targetCreatureId',_event->'targetCreatureId','occurredAt',_event->'occurredAt',
 'meta',CASE WHEN jsonb_typeof(_event->'meta')='object' THEN jsonb_strip_nulls(jsonb_build_object(
 'effectKind',_event#>'{meta,effectKind}','effectType',_event#>'{meta,effectType}','durationMs',_event#>'{meta,durationMs}','intervalMs',_event#>'{meta,intervalMs}',
 'stance',_event#>'{meta,stance}','attacks',_event#>'{meta,attacks}','reserveHp',_event#>'{meta,reserveHp}','blockChance',_event#>'{meta,blockChance}','mode',_event#>'{meta,mode}',
 'isTaunt',_event#>'{meta,isTaunt}','stacks',_event#>'{meta,stacks}','maxStacks',_event#>'{meta,maxStacks}','stackNoun',_event#>'{meta,stackNoun}','refunded',_event#>'{meta,refunded}',
 'conflictsWith',_event#>'{meta,conflictsWith}','reservePct',_event#>'{meta,reservePct}','resolveAtTick',_event#>'{meta,resolveAtTick}','text',_event#>'{meta,text}',
 'isCrit',_event#>'{meta,isCrit}','percentMitigated',_event#>'{meta,percentMitigated}','shieldBonusApplied',_event#>'{meta,shieldBonusApplied}','critSoftened',_event#>'{meta,critSoftened}',
 'flatMitigated',_event#>'{meta,flatMitigated}','blocked',_event#>'{meta,blocked}','absorbed',_event#>'{meta,absorbed}','reactive',_event#>'{meta,reactive}',
 'damageType',_event#>'{meta,damageType}','healing',_event#>'{meta,healing}','deathCry',_event#>'{meta,deathCry}','killedBy',_event#>'{meta,killedBy}',
 'requested',_event#>'{meta,requested}','applied',_event#>'{meta,applied}','wasted',_event#>'{meta,wasted}','hpRequested',_event#>'{meta,hpRequested}',
 'hpApplied',_event#>'{meta,hpApplied}','hpWasted',_event#>'{meta,hpWasted}','cpRequested',_event#>'{meta,cpRequested}','cpApplied',_event#>'{meta,cpApplied}',
 'cpWasted',_event#>'{meta,cpWasted}','removedFromCaster',_event#>'{meta,removedFromCaster}','remaining',_event#>'{meta,remaining}','depleted',_event#>'{meta,depleted}')) END)); $$;
REVOKE ALL ON FUNCTION public.combat2_test_safe_event(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.combat2_sync(_character_id uuid,_encounter_id uuid,_after_tick bigint DEFAULT 0,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; actor_party uuid; actor_parties uuid[]; actor_party_at_entry uuid;
BEGIN result:=public.combat2_sync_without_allies(_character_id,_encounter_id,_after_tick,_limit); IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 SELECT nf.party_id_at_entry INTO actor_party_at_entry FROM public.node_fighter nf WHERE nf.encounter_id=_encounter_id AND nf.character_id=_character_id AND nf.present;
 SELECT array_agg(pm.party_id ORDER BY pm.party_id) INTO actor_parties FROM public.party_members pm WHERE pm.character_id=_character_id AND pm.status='accepted';
 IF COALESCE(cardinality(actor_parties),0)=1 THEN actor_party:=actor_parties[1]; END IF;
 RETURN result||jsonb_build_object('allies',COALESCE((SELECT jsonb_agg(jsonb_build_object('characterId',nf.character_id,'fighterId',nf.id,'entrySeq',nf.entry_seq,
 'name',c.name,'hp',c.hp,'maxHp',c.max_hp,'cp',c.cp,'maxCp',c.max_cp,'mp',c.mp,'maxMp',c.max_mp,'present',nf.present) ORDER BY nf.entry_seq,nf.id)
 FROM public.node_fighter nf JOIN public.characters c ON c.id=nf.character_id LEFT JOIN public.party_members pm ON pm.character_id=nf.character_id AND pm.status='accepted'
 WHERE nf.encounter_id=_encounter_id AND nf.present AND c.hp>0 AND (nf.character_id=_character_id OR (actor_party IS NOT NULL AND actor_party=actor_party_at_entry
 AND pm.party_id=actor_party AND nf.party_id_at_entry=actor_party_at_entry))),'[]'::jsonb)); END $$;
REVOKE ALL ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) TO authenticated,service_role;
