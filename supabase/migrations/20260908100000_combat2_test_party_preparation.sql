-- Test-Arena-only authority for preparing and cleaning one disposable two-character party.
CREATE TABLE public.combat2_test_arena_party (
  arena_id uuid PRIMARY KEY REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL UNIQUE REFERENCES public.parties(id) ON DELETE CASCADE,
  character_a_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  character_b_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE RESTRICT,
  prepared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  CHECK (character_a_id <> character_b_id)
);
CREATE TABLE public.combat2_test_arena_party_request (
  request_id uuid PRIMARY KEY,
  arena_id uuid NOT NULL REFERENCES public.combat2_test_arena(id) ON DELETE RESTRICT,
  caller_id uuid,
  character_a_id uuid NOT NULL,
  character_b_id uuid NOT NULL,
  replace_existing boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.combat2_test_arena_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combat2_test_arena_party_request ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.combat2_test_arena_party,public.combat2_test_arena_party_request FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.combat2_test_arena_party,public.combat2_test_arena_party_request TO service_role;

CREATE FUNCTION public.combat2_test_party_prepare(
  _arena_id uuid,_character_a_id uuid,_character_b_id uuid,_request_id uuid,_replace_existing boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE caller uuid:=auth.uid(); prior public.combat2_test_arena_party_request; tracked public.combat2_test_arena_party;
 party uuid; node_a uuid; node_b uuid; result jsonb;
BEGIN
 IF NOT public.combat2_test_admin_allowed() THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat2-test:'||_arena_id::text,0));
 SELECT * INTO prior FROM public.combat2_test_arena_party_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.arena_id<>_arena_id OR prior.caller_id IS DISTINCT FROM caller
   OR prior.character_a_id<>_character_a_id OR prior.character_b_id<>_character_b_id
   OR prior.replace_existing<>_replace_existing THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN prior.result;
 END IF;
 IF _character_a_id IS NULL OR _character_b_id IS NULL OR _character_a_id=_character_b_id
  THEN RETURN jsonb_build_object('ok',false,'kind','invalid_selection'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.combat2_test_arena WHERE id=_arena_id AND active)
  THEN RETURN jsonb_build_object('ok',false,'kind','unknown_arena'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND claim_token IS NOT NULL)
  THEN RETURN jsonb_build_object('ok',false,'kind','active_claim'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat2_departure_request WHERE status='pending' AND (character_id IN(_character_a_id,_character_b_id)
   OR origin_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id)
   OR destination_node_id IN(SELECT node_id FROM public.combat2_test_arena_node WHERE arena_id=_arena_id)))
  THEN RETURN jsonb_build_object('ok',false,'kind','active_departure'); END IF;
 IF EXISTS(SELECT 1 FROM public.node_encounter WHERE test_arena_id=_arena_id AND status='active')
  OR EXISTS(SELECT 1 FROM public.node_fighter nf JOIN public.node_encounter e ON e.id=nf.encounter_id
   WHERE nf.character_id IN(_character_a_id,_character_b_id) AND nf.present AND e.status='active')
  OR EXISTS(SELECT 1 FROM public.combat_sessions WHERE character_id IN(_character_a_id,_character_b_id))
  THEN RETURN jsonb_build_object('ok',false,'kind','conflicting_encounter'); END IF;

 SELECT * INTO tracked FROM public.combat2_test_arena_party WHERE arena_id=_arena_id FOR UPDATE;
 IF FOUND AND (((tracked.character_a_id=_character_a_id AND tracked.character_b_id=_character_b_id)
   OR (tracked.character_a_id=_character_b_id AND tracked.character_b_id=_character_a_id))
   AND (SELECT count(*) FROM public.party_members WHERE party_id=tracked.party_id)=2
   AND (SELECT count(*) FROM public.party_members WHERE party_id=tracked.party_id AND status='accepted')=2) THEN
  result:=jsonb_build_object('ok',true,'kind','already_prepared','character_a_id',_character_a_id,'character_b_id',_character_b_id,'member_count',2);
  INSERT INTO public.combat2_test_arena_party_request VALUES(_request_id,_arena_id,caller,_character_a_id,_character_b_id,_replace_existing,result,now());
  RETURN result;
 END IF;
 IF FOUND AND NOT _replace_existing THEN RETURN jsonb_build_object('ok',false,'kind','replacement_confirmation_required'); END IF;

 SELECT c.current_node_id INTO node_a FROM public.characters c JOIN public.combat2_test_arena_access x
   ON x.character_id=c.id AND x.user_id=c.user_id AND x.arena_id=_arena_id AND x.active AND x.revoked_at IS NULL
   JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active
   WHERE c.id=_character_a_id AND c.hp>0 FOR UPDATE OF c;
 SELECT c.current_node_id INTO node_b FROM public.characters c JOIN public.combat2_test_arena_access x
   ON x.character_id=c.id AND x.user_id=c.user_id AND x.arena_id=_arena_id AND x.active AND x.revoked_at IS NULL
   JOIN public.combat2_test_arena_node n ON n.arena_id=x.arena_id AND n.node_id=c.current_node_id AND n.active
   WHERE c.id=_character_b_id AND c.hp>0 FOR UPDATE OF c;
 IF node_a IS NULL OR node_b IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','tester_not_eligible'); END IF;
 IF node_a<>node_b THEN RETURN jsonb_build_object('ok',false,'kind','testers_not_colocated'); END IF;

 IF EXISTS(SELECT 1 FROM public.party_members pm WHERE pm.character_id IN(_character_a_id,_character_b_id)
    AND (tracked.party_id IS NULL OR pm.party_id<>tracked.party_id))
  OR EXISTS(SELECT 1 FROM public.parties p WHERE p.leader_id IN(_character_a_id,_character_b_id)
    AND (tracked.party_id IS NULL OR p.id<>tracked.party_id))
  THEN RETURN jsonb_build_object('ok',false,'kind','ordinary_party_conflict'); END IF;
 IF tracked.party_id IS NOT NULL THEN DELETE FROM public.parties WHERE id=tracked.party_id; END IF;

 INSERT INTO public.parties(leader_id,tank_id) VALUES(_character_a_id,_character_a_id) RETURNING id INTO party;
 INSERT INTO public.party_members(party_id,character_id,status,is_following) VALUES
  (party,_character_a_id,'accepted',false),(party,_character_b_id,'accepted',false);
 INSERT INTO public.combat2_test_arena_party(arena_id,party_id,character_a_id,character_b_id,prepared_by)
  VALUES(_arena_id,party,_character_a_id,_character_b_id,caller);
 result:=jsonb_build_object('ok',true,'kind','party_prepared','character_a_id',_character_a_id,'character_b_id',_character_b_id,'member_count',2);
 INSERT INTO public.combat2_test_arena_party_request VALUES(_request_id,_arena_id,caller,_character_a_id,_character_b_id,_replace_existing,result,now());
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','party_prepare_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_party_prepare(uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_party_prepare(uuid,uuid,uuid,uuid,boolean) TO authenticated,service_role;

-- The client may pass preflight only with no party, or with the one tracked arena party.
CREATE FUNCTION public.combat2_test_session_preflight(_character_id uuid,_node_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE arena uuid; memberships integer; tracked_memberships integer;
BEGIN
 SELECT n.arena_id INTO arena FROM public.combat2_test_arena_node n JOIN public.combat2_test_arena a ON a.id=n.arena_id AND a.active
  WHERE n.node_id=_node_id AND n.active;
 IF arena IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_test_node'); END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.characters c WHERE c.id=_character_id AND c.user_id=auth.uid() AND c.current_node_id=_node_id AND c.hp>0)
  OR NOT public.combat2_test_arena_access_allowed(auth.uid(),_character_id,_node_id)
  THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 IF EXISTS(SELECT 1 FROM public.combat_sessions WHERE character_id=_character_id)
  THEN RETURN jsonb_build_object('ok',false,'kind','legacy_session_active'); END IF;
 SELECT count(*) INTO memberships FROM public.party_members WHERE character_id=_character_id AND status='accepted';
 SELECT count(*) INTO tracked_memberships FROM public.party_members pm JOIN public.combat2_test_arena_party tp ON tp.party_id=pm.party_id AND tp.arena_id=arena
  WHERE pm.character_id=_character_id AND pm.status='accepted';
 IF memberships<>tracked_memberships OR memberships>1 OR EXISTS(SELECT 1 FROM public.parties p WHERE p.leader_id=_character_id
   AND NOT EXISTS(SELECT 1 FROM public.combat2_test_arena_party tp WHERE tp.arena_id=arena AND tp.party_id=p.id))
  THEN RETURN jsonb_build_object('ok',false,'kind','party_not_authorized'); END IF;
 RETURN jsonb_build_object('ok',true,'kind','eligible','party_test',tracked_memberships=1);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'kind','preflight_failed');
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_session_preflight(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_session_preflight(uuid,uuid) TO authenticated,service_role;

-- Preserve the installed reset implementation and add exact temporary-party cleanup.
ALTER FUNCTION public.combat2_test_reset(uuid,uuid,boolean) RENAME TO combat2_test_reset_without_party_cleanup;
REVOKE ALL ON FUNCTION public.combat2_test_reset_without_party_cleanup(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset_without_party_cleanup(uuid,uuid,boolean) TO service_role;
CREATE FUNCTION public.combat2_test_reset(_arena_id uuid,_request_id uuid,_confirm_destroy_diagnostics boolean) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $$
DECLARE outcome jsonb; removed integer:=0;
BEGIN
 outcome:=public.combat2_test_reset_without_party_cleanup(_arena_id,_request_id,_confirm_destroy_diagnostics);
 IF COALESCE((outcome->>'ok')::boolean,false) THEN
  IF outcome ? 'temporary_parties_removed' THEN RETURN outcome; END IF;
  DELETE FROM public.parties p USING public.combat2_test_arena_party tp WHERE tp.arena_id=_arena_id AND p.id=tp.party_id;
  GET DIAGNOSTICS removed=ROW_COUNT;
  outcome:=outcome||jsonb_build_object('temporary_parties_removed',removed);
  UPDATE public.combat2_test_arena_request SET result=outcome WHERE request_id=_request_id AND arena_id=_arena_id;
 END IF;
 RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_test_reset(uuid,uuid,boolean) TO authenticated,service_role;

-- Extend only the safe event allowlist with final-ability evidence already present in committed events.
CREATE OR REPLACE FUNCTION public.combat2_test_safe_event(_event jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object(
  'seq',_event->'seq','kind',_event->'kind',
  'actor',CASE WHEN jsonb_typeof(_event->'actor')='object' THEN jsonb_strip_nulls(jsonb_build_object('type',_event#>>'{actor,type}','id',_event#>>'{actor,id}','name',_event#>>'{actor,name}')) END,
  'target',CASE WHEN jsonb_typeof(_event->'target')='object' THEN jsonb_strip_nulls(jsonb_build_object('type',_event#>>'{target,type}','id',_event#>>'{target,id}','name',_event#>>'{target,name}')) END,
  'abilityKey',_event->'abilityKey','amount',_event->'amount','hitQuality',_event->'hitQuality','outcomeReason',_event->'outcomeReason',
  'eventType',_event->'eventType','actorCharacterId',_event->'actorCharacterId','actorCreatureId',_event->'actorCreatureId',
  'targetCharacterId',_event->'targetCharacterId','targetCreatureId',_event->'targetCreatureId','occurredAt',_event->'occurredAt',
  'meta',CASE WHEN jsonb_typeof(_event->'meta')='object' THEN jsonb_strip_nulls(jsonb_build_object(
   'effectKind',_event#>'{meta,effectKind}','effectType',_event#>'{meta,effectType}','durationMs',_event#>'{meta,durationMs}',
   'intervalMs',_event#>'{meta,intervalMs}','stance',_event#>'{meta,stance}','attacks',_event#>'{meta,attacks}',
   'reserveHp',_event#>'{meta,reserveHp}','blockChance',_event#>'{meta,blockChance}','mode',_event#>'{meta,mode}',
   'isTaunt',_event#>'{meta,isTaunt}','stacks',_event#>'{meta,stacks}','maxStacks',_event#>'{meta,maxStacks}',
   'stackNoun',_event#>'{meta,stackNoun}','refunded',_event#>'{meta,refunded}','conflictsWith',_event#>'{meta,conflictsWith}',
   'reservePct',_event#>'{meta,reservePct}','resolveAtTick',_event#>'{meta,resolveAtTick}','text',_event#>'{meta,text}',
   'isCrit',_event#>'{meta,isCrit}','percentMitigated',_event#>'{meta,percentMitigated}','shieldBonusApplied',_event#>'{meta,shieldBonusApplied}',
   'critSoftened',_event#>'{meta,critSoftened}','flatMitigated',_event#>'{meta,flatMitigated}','blocked',_event#>'{meta,blocked}',
   'absorbed',_event#>'{meta,absorbed}','reactive',_event#>'{meta,reactive}','damageType',_event#>'{meta,damageType}',
   'healing',_event#>'{meta,healing}','deathCry',_event#>'{meta,deathCry}','killedBy',_event#>'{meta,killedBy}',
   'requested',_event#>'{meta,requested}','applied',_event#>'{meta,applied}','wasted',_event#>'{meta,wasted}',
   'hpRequested',_event#>'{meta,hpRequested}','hpApplied',_event#>'{meta,hpApplied}','hpWasted',_event#>'{meta,hpWasted}',
   'cpRequested',_event#>'{meta,cpRequested}','cpApplied',_event#>'{meta,cpApplied}','cpWasted',_event#>'{meta,cpWasted}',
   'removedFromCaster',_event#>'{meta,removedFromCaster}','remaining',_event#>'{meta,remaining}','depleted',_event#>'{meta,depleted}'
  )) END));
$$;
REVOKE ALL ON FUNCTION public.combat2_test_safe_event(jsonb) FROM PUBLIC,anon,authenticated;

-- Keep the client ally roster generation-fenced to the party captured at entry.
CREATE OR REPLACE FUNCTION public.combat2_sync(_character_id uuid,_encounter_id uuid,
  _after_tick bigint DEFAULT 0,_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; actor_party uuid; actor_party_at_entry uuid;
BEGIN
 result:=public.combat2_sync_without_allies(_character_id,_encounter_id,_after_tick,_limit);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 SELECT nf.party_id_at_entry INTO actor_party_at_entry FROM public.node_fighter nf
  WHERE nf.encounter_id=_encounter_id AND nf.character_id=_character_id AND nf.present;
 SELECT pm.party_id INTO actor_party FROM public.party_members pm
  WHERE pm.character_id=_character_id AND pm.status='accepted' LIMIT 1;
 RETURN result || jsonb_build_object('allies',COALESCE((
  SELECT jsonb_agg(jsonb_build_object('characterId',nf.character_id,'fighterId',nf.id,
    'entrySeq',nf.entry_seq,'name',c.name,'hp',c.hp,'maxHp',c.max_hp,
    'cp',c.cp,'maxCp',c.max_cp,'mp',c.mp,'maxMp',c.max_mp,'present',nf.present)
    ORDER BY nf.entry_seq,nf.id)
  FROM public.node_fighter nf JOIN public.characters c ON c.id=nf.character_id
  LEFT JOIN public.party_members pm ON pm.character_id=nf.character_id AND pm.status='accepted'
  WHERE nf.encounter_id=_encounter_id AND nf.present AND c.hp>0
    AND (nf.character_id=_character_id OR (actor_party IS NOT NULL AND actor_party=actor_party_at_entry
      AND pm.party_id=actor_party AND nf.party_id_at_entry=actor_party_at_entry))
 ),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_sync(uuid,uuid,bigint,integer) TO authenticated,service_role;
