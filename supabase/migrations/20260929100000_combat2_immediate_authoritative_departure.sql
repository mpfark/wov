-- ENG-MOVE-001: finish ordinary Combat2 relocation in the caller transaction.
-- The installed predecessors remain the sole owners of movement validation,
-- cost calculation, party inclusion, and durable request creation.
DO $$
BEGIN
  IF to_regprocedure('public.combat2_depart(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_party_depart(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_depart_without_canary_gate(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat_flee(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_refresh_tanks(uuid)') IS NULL
     OR to_regprocedure('public.settle_out_of_combat_resources(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'ENG-MOVE-001 predecessor contract is incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_encounter' AND column_name='claim_expires_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_pending_event' AND column_name='consumed_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_pending_event' AND column_name='consumed_tick')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_intent' AND column_name='target_character_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='node_effect' AND column_name='target_character_id') THEN
    RAISE EXCEPTION 'ENG-MOVE-001 installed schema drift';
  END IF;
END;
$$;

-- Arena reset locks encounters by UUID before touching characters. Pre-lock the
-- origin/destination encounter pair in that same order so authoritative arrival
-- never holds a mover character while waiting for the destination encounter.
DO $$
DECLARE definition text; needle text; replacement text; before_row record;
BEGIN
  SELECT p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl,pg_get_functiondef(p.oid) definition
    INTO before_row FROM pg_proc p
    WHERE p.oid='public.combat2_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure;
  IF pg_get_userbyid(before_row.proowner)<>'postgres' OR NOT before_row.prosecdef
     OR before_row.provolatile<>'v' OR before_row.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'ENG-MOVE-001 solo predecessor metadata drift';
  END IF;
  needle := E'  SELECT * INTO v_encounter FROM public.node_encounter\n    WHERE node_id = v_origin AND status = ''active'' FOR UPDATE;';
  IF position(needle in before_row.definition)=0 THEN RAISE EXCEPTION 'ENG-MOVE-001 solo encounter lock drift'; END IF;
  replacement := E'  PERFORM 1 FROM public.node_encounter\n    WHERE node_id IN (v_origin,_destination_node_id) ORDER BY id FOR UPDATE;\n'||needle;
  EXECUTE replace(before_row.definition,needle,replacement);
  IF EXISTS (SELECT 1 FROM pg_proc p
    WHERE p.oid='public.combat2_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure
      AND (p.proowner IS DISTINCT FROM before_row.proowner OR p.prosecdef IS DISTINCT FROM before_row.prosecdef
        OR p.provolatile IS DISTINCT FROM before_row.provolatile OR p.proconfig IS DISTINCT FROM before_row.proconfig
        OR p.proacl IS DISTINCT FROM before_row.proacl)) THEN
    RAISE EXCEPTION 'ENG-MOVE-001 solo predecessor metadata/ACL changed';
  END IF;
END;
$$;

-- Patch only the installed inner party predecessor. Party membership is stable
-- under the existing party-lifecycle advisory. The complete mover UUID set is
-- frozen before any character row lock, all character rows are then locked in
-- UUID order (matching resource settlement), and movement still uses the
-- predecessor's joined_at/UUID follower order with the leader last.
DO $$
DECLARE
  definition text;
  wrapper_definition text;
  declaration_needle text;
  leader_lock_needle text;
  mover_relock_needle text;
  encounter_lock_needle text;
  guard_needle text;
  guard_offset integer;
  normalized_definition text;
  preflight_order_needle text:='ORDER BY leader_last,joined_at,id LOOP PERFORM 1 FROM public.characters WHERE id=mover.id FOR UPDATE;';
  movement_order_needle text:='UNION ALL SELECT leader.*,NULL::timestamptz,true ORDER BY leader_last,joined_at,id LOOP ordinal:=ordinal+1;';
  before_owner oid;
  before_security boolean;
  before_volatility "char";
  before_config text[];
  before_acl aclitem[];
  wrapper_owner oid;
  wrapper_security boolean;
  wrapper_volatility "char";
  wrapper_config text[];
  wrapper_acl aclitem[];
BEGIN
  SELECT pg_get_functiondef(p.oid),p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
    INTO wrapper_definition,wrapper_owner,wrapper_security,wrapper_volatility,wrapper_config,wrapper_acl
    FROM pg_proc p WHERE p.oid='public.combat2_party_depart(uuid,uuid,uuid)'::regprocedure;
  IF position('combat2_party_depart_without_canary_gate' in wrapper_definition)=0 THEN
    RAISE EXCEPTION 'ENG-MOVE-001 party wrapper composition drift';
  END IF;
  IF pg_get_userbyid(wrapper_owner)<>'postgres' OR NOT wrapper_security OR wrapper_volatility<>'v'
     OR wrapper_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'ENG-MOVE-001 public party wrapper metadata drift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(wrapper_acl,acldefault('f',wrapper_owner))) acl
    LEFT JOIN pg_roles role ON role.oid=acl.grantee
    WHERE acl.privilege_type='EXECUTE' AND (acl.grantee=0 OR role.rolname='anon')
  ) OR NOT EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(wrapper_acl,acldefault('f',wrapper_owner))) acl
    JOIN pg_roles role ON role.oid=acl.grantee
    WHERE acl.privilege_type='EXECUTE' AND role.rolname='authenticated'
  ) THEN RAISE EXCEPTION 'ENG-MOVE-001 public party wrapper ACL drift'; END IF;
  SELECT pg_get_functiondef(p.oid),p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
    INTO definition,before_owner,before_security,before_volatility,before_config,before_acl
    FROM pg_proc p WHERE p.oid='public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure;
  IF pg_get_userbyid(before_owner)<>'postgres' OR NOT before_security OR before_volatility<>'v'
     OR before_config IS DISTINCT FROM ARRAY['search_path=public, auth, pg_temp']::text[] THEN
    RAISE EXCEPTION 'ENG-MOVE-001 party predecessor metadata drift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(before_acl,acldefault('f',before_owner))) acl
    LEFT JOIN pg_roles role ON role.oid=acl.grantee
    WHERE acl.privilege_type='EXECUTE' AND (acl.grantee=0 OR role.rolname IN('anon','authenticated'))
  ) THEN RAISE EXCEPTION 'ENG-MOVE-001 party predecessor browser ACL drift'; END IF;
  normalized_definition:=regexp_replace(definition,'[[:space:]]+',' ','g');
  IF position('PERFORM pg_advisory_xact_lock(hashtextextended(''party-lifecycle'',0))' in definition)=0
     OR position(preflight_order_needle in normalized_definition)=0
     OR position(movement_order_needle in normalized_definition)=0
     OR position('SELECT * INTO leader FROM public.characters WHERE id=_leader_character_id FOR UPDATE' in definition)=0
     OR position('IF encounter.claim_token IS NOT NULL AND encounter.claim_expires_at>now()' in definition)=0
     OR position('FOR c IN SELECT * FROM public.characters ORDER BY id FOR UPDATE LOOP' in
       pg_get_functiondef('public.settle_out_of_combat_resources(timestamptz)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'ENG-MOVE-001 expected party/settlement lock contract drift';
  END IF;
  FOREACH guard_needle IN ARRAY ARRAY[
    'PERFORM pg_advisory_xact_lock(hashtextextended(''party-lifecycle'',0))',
    'SELECT * INTO leader FROM public.characters WHERE id=_leader_character_id FOR UPDATE',
    'IF encounter.claim_token IS NOT NULL AND encounter.claim_expires_at>now()'
  ] LOOP
    guard_offset:=position(guard_needle in definition);
    IF guard_offset=0 OR position(guard_needle in substring(definition FROM guard_offset+length(guard_needle)))>0 THEN
      RAISE EXCEPTION 'ENG-MOVE-001 expected party lock contract must occur exactly once';
    END IF;
  END LOOP;
  FOREACH guard_needle IN ARRAY ARRAY[preflight_order_needle,movement_order_needle] LOOP
    guard_offset:=position(guard_needle in normalized_definition);
    IF guard_offset=0 OR position(guard_needle in substring(normalized_definition FROM guard_offset+length(guard_needle)))>0 THEN
      RAISE EXCEPTION 'ENG-MOVE-001 expected party order context must occur exactly once';
    END IF;
  END LOOP;
  guard_needle:='FOR c IN SELECT * FROM public.characters ORDER BY id FOR UPDATE LOOP';
  definition:=pg_get_functiondef('public.settle_out_of_combat_resources(timestamptz)'::regprocedure);
  guard_offset:=position(guard_needle in definition);
  IF guard_offset=0 OR position(guard_needle in substring(definition FROM guard_offset+length(guard_needle)))>0 THEN
    RAISE EXCEPTION 'ENG-MOVE-001 expected settlement lock contract must occur exactly once';
  END IF;
  SELECT pg_get_functiondef('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure) INTO definition;

  declaration_needle := ' ordinal integer:=0; child uuid; event_id uuid; queued integer:=0; outcomes jsonb;';
  encounter_lock_needle := ' SELECT * INTO encounter FROM public.node_encounter WHERE node_id=leader.current_node_id AND status=''active'' FOR UPDATE;';
  leader_lock_needle := ' SELECT * INTO leader FROM public.characters WHERE id=_leader_character_id FOR UPDATE;';
  mover_relock_needle := '  PERFORM 1 FROM public.characters WHERE id=mover.id FOR UPDATE;';
  IF position(declaration_needle in definition)=0 OR position(encounter_lock_needle in definition)=0 OR position(leader_lock_needle in definition)=0
     OR position(mover_relock_needle in definition)=0 THEN
    RAISE EXCEPTION 'ENG-MOVE-001 early-leader predecessor drift';
  END IF;
  definition:=replace(definition,declaration_needle,
    declaration_needle||' mover_ids uuid[]; locked_count integer; locked_origin uuid;');
  definition:=replace(definition,encounter_lock_needle,
    ' PERFORM 1 FROM public.node_encounter WHERE node_id IN(leader.current_node_id,_destination_node_id) ORDER BY id FOR UPDATE;'||chr(10)||encounter_lock_needle);
  definition:=replace(definition,
    ' IF encounter.claim_token IS NOT NULL AND encounter.claim_expires_at>now() THEN RETURN jsonb_build_object(''ok'',false,''kind'',''live_claim''); END IF;',
    ' -- ENG-MOVE-001: the immediate owner fences the captured claim below.');
  definition:=replace(definition,leader_lock_needle,$body$
 -- Freeze the complete authoritative mover set without taking a character row
 -- lock, then acquire the entire set in the same UUID order as settlement.
 locked_origin:=leader.current_node_id;
 SELECT array_agg(candidate.id ORDER BY candidate.id) INTO mover_ids FROM (
  SELECT c.id FROM public.party_members pm JOIN public.characters c ON c.id=pm.character_id
   WHERE pm.party_id=p.id AND pm.status='accepted' AND pm.is_following
     AND c.id<>leader.id AND c.current_node_id=leader.current_node_id AND c.hp>0
  UNION ALL SELECT leader.id
 ) candidate;
 PERFORM 1 FROM public.characters c WHERE c.id=ANY(mover_ids) ORDER BY c.id FOR UPDATE;
 GET DIAGNOSTICS locked_count=ROW_COUNT;
 IF locked_count<>cardinality(mover_ids) THEN
  RETURN jsonb_build_object('ok',false,'kind','party_changed');
 END IF;
 SELECT * INTO leader FROM public.characters WHERE id=_leader_character_id;
 IF leader.id IS NULL OR leader.user_id<>caller OR leader.current_node_id IS DISTINCT FROM locked_origin THEN
  RETURN jsonb_build_object('ok',false,'kind','party_changed');
 END IF;
 IF leader.hp<=0 THEN RETURN jsonb_build_object('ok',false,'kind','dead','member',leader.name); END IF;
 IF EXISTS (
  SELECT 1 FROM unnest(mover_ids) included(id) JOIN public.characters c ON c.id=included.id
  WHERE c.id<>leader.id AND (c.current_node_id IS DISTINCT FROM leader.current_node_id OR c.hp<=0 OR NOT EXISTS (
    SELECT 1 FROM public.party_members pm WHERE pm.party_id=p.id AND pm.character_id=c.id
      AND pm.status='accepted' AND pm.is_following
  ))
 ) THEN RETURN jsonb_build_object('ok',false,'kind','party_changed'); END IF;$body$);
  definition:=replace(definition,mover_relock_needle,
    '  -- Every included character row is already held by the canonical UUID lock set.');
  EXECUTE definition;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure
      AND (p.proowner IS DISTINCT FROM before_owner OR p.prosecdef IS DISTINCT FROM before_security
        OR p.provolatile IS DISTINCT FROM before_volatility OR p.proconfig IS DISTINCT FROM before_config
        OR p.proacl IS DISTINCT FROM before_acl)
  ) THEN RAISE EXCEPTION 'ENG-MOVE-001 party predecessor metadata/ACL changed'; END IF;
  SELECT pg_get_functiondef('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(leader_lock_needle in definition)>0
     OR position('ORDER BY c.id FOR UPDATE' in definition)=0
     OR position('ORDER BY leader_last,joined_at,id' in definition)=0 THEN
    RAISE EXCEPTION 'ENG-MOVE-001 corrected party lock/movement contract missing';
  END IF;
END;
$$;

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

DO $$
DECLARE signature regprocedure; p record;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.combat2_depart(uuid,uuid,uuid)'::regprocedure,
    'public.combat2_party_depart(uuid,uuid,uuid)'::regprocedure,
    'public.combat_flee(uuid,uuid,uuid)'::regprocedure
  ] LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=signature;
    IF pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
      RAISE EXCEPTION 'ENG-MOVE-001 public function metadata drift: %',signature;
    END IF;
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles role ON role.oid=acl.grantee
      WHERE acl.privilege_type='EXECUTE' AND (acl.grantee=0 OR role.rolname='anon')
    ) OR 2<>(
      SELECT count(DISTINCT role.rolname) FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      JOIN pg_roles role ON role.oid=acl.grantee
      WHERE acl.privilege_type='EXECUTE' AND role.rolname IN('authenticated','service_role')
    ) THEN RAISE EXCEPTION 'ENG-MOVE-001 public function ACL drift: %',signature; END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'public.combat2_finish_immediate_departure(uuid)'::regprocedure,
    'public.combat2_finish_immediate_party_departure(uuid)'::regprocedure,
    'public.combat2_depart_without_immediate_transition(uuid,uuid,uuid)'::regprocedure,
    'public.combat2_party_depart_without_immediate_transition(uuid,uuid,uuid)'::regprocedure,
    'public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure
  ] LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=signature;
    IF pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'v'
       OR p.proconfig IS DISTINCT FROM CASE WHEN signature='public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure
         THEN ARRAY['search_path=public, auth, pg_temp']::text[] ELSE ARRAY['search_path=public, pg_temp']::text[] END THEN
      RAISE EXCEPTION 'ENG-MOVE-001 internal function metadata drift: %',signature;
    END IF;
    IF EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
      LEFT JOIN pg_roles role ON role.oid=acl.grantee
      WHERE acl.privilege_type='EXECUTE' AND (acl.grantee=0 OR role.rolname IN('anon','authenticated'))
    ) THEN RAISE EXCEPTION 'ENG-MOVE-001 internal function browser ACL drift: %',signature; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='combat2_party_departure_member_finalized' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ENG-MOVE-001 heartbeat-dependent party finalizer remains active';
  END IF;
END;
$$;
