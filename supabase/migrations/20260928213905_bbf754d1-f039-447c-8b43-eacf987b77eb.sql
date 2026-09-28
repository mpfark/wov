-- ENG-COMBAT-002: authoritative entry at movement completion and one generic,
-- atomic hostile-first-action boundary. Combat resolution remains owned by the
-- existing claim/decode/resolve/commit heartbeat chain.
BEGIN;

DO $$
DECLARE
  v_outer text; v_middle text; v_inner text;
  v_case_pattern text := 'CASE\s+WHEN g\.party_id IS NULL THEN 0\s+WHEN nf\.character_id = p\.tank_id THEN 0\s+WHEN nf\.character_id = p\.leader_id THEN 1\s+ELSE 2\s+END AS member_priority';
  v_order_pattern text := 'representative\.arrival_seq\s+DESC,\s*representative\.group_id\s+DESC,\s*representative\.member_priority,\s*representative\.entry_seq\s+DESC,\s*representative\.fighter_id\s+DESC';
BEGIN
  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('characters','id'), ('characters','current_node_id'), ('characters','hp'), ('characters','class'),
      ('creatures','id'), ('creatures','node_id'), ('creatures','is_alive'), ('creatures','is_aggressive'),
      ('node_encounter','id'), ('node_encounter','node_id'), ('node_encounter','status'),
      ('node_encounter','tick'), ('node_encounter','state_version'), ('node_encounter','claim_token'),
      ('node_encounter','claimed_tick'), ('node_encounter','claim_expires_at'), ('node_encounter','intent_cutoff_seq'),
      ('node_encounter','next_due_at'), ('node_encounter','updated_at'),
      ('node_fighter','id'), ('node_fighter','encounter_id'), ('node_fighter','character_id'),
      ('node_fighter','entry_seq'), ('node_fighter','present'), ('node_fighter','arrival_group_id'),
      ('node_fighter','left_at'), ('node_fighter','joined_at'), ('node_fighter','party_id_at_entry'),
      ('node_fighter','exit_request_id'), ('node_fighter','updated_at'),
      ('node_arrival_group','id'), ('node_arrival_group','encounter_id'), ('node_arrival_group','party_id'),
      ('node_arrival_group','generation'), ('node_arrival_group','arrival_seq'),
      ('node_arrival_group','active'), ('node_arrival_group','deactivated_at'),
      ('node_creature','id'), ('node_creature','encounter_id'), ('node_creature','creature_id'),
      ('node_creature','is_alive'), ('node_creature','engaged'), ('node_creature','tank_fighter_id'),
      ('node_creature','updated_at'),
      ('node_pending_event','id'), ('node_pending_event','request_id'), ('node_pending_event','encounter_id'),
      ('node_pending_event','event_type'), ('node_pending_event','actor_character_id'),
      ('node_pending_event','payload'), ('node_pending_event','consumed_at'), ('node_pending_event','consumed_tick'),
      ('node_intent','id'), ('node_intent','seq'), ('node_intent','status'),
      ('node_intent','request_id'), ('node_intent','encounter_id'), ('node_intent','character_id'),
      ('node_intent','intent_kind'), ('node_intent','ability_key'), ('node_intent','target_creature_id'),
      ('node_intent','reject_reason'),
      ('party_members','party_id'), ('party_members','character_id'), ('party_members','status'),
      ('class_ability_assignments','ability_id'), ('class_ability_assignments','class_key'),
      ('class_ability_assignments','class_ability_key'), ('class_ability_assignments','status'),
      ('class_ability_assignments','unlock_level'),
      ('abilities','id'), ('abilities','ability_key'), ('abilities','status'),
      ('abilities','target_type'), ('abilities','activation_mode')
    ) AS required(table_name,column_name)
    EXCEPT
    SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
  ) THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: required installed-equivalent column is missing';
  END IF;

  IF to_regprocedure('public.combat_enter_without_engagement_gate(uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_seed_spawns(uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_refresh_tanks(uuid)') IS NULL
     OR to_regprocedure('public.node_tick_claim(uuid,integer)') IS NULL
     OR to_regprocedure('public.node_tick_claim_without_boss_timing(uuid,integer)') IS NULL
     OR to_regprocedure('public.node_tick_claim_without_canary_gate(uuid,integer)') IS NULL
     OR to_regprocedure('public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)') IS NULL
     OR to_regprocedure('public.combat2_depart_without_canary_gate(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.combat2_movement_scope_eligible(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: required installed function signature is missing';
  END IF;

  IF to_regclass('public.node_fighter_entry_seq_seq') IS NULL THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: authoritative entry sequence is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid='public.characters'::regclass AND t.tgname='combat2_authoritative_arrival'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: authoritative-arrival trigger already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)'::regprocedure
      AND p.prosecdef AND 'search_path=public, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected combat_intent security/search_path contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.combat2_party_depart_without_canary_gate(uuid,uuid,uuid)'::regprocedure
      AND p.prosecdef AND 'search_path=public, auth, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected party-depart predecessor search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE p.oid='public.node_tick_claim(uuid,integer)'::regprocedure
      AND owner.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND 'search_path=public, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE p.oid='public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure
      AND owner.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND 'search_path=public, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE p.oid='public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure
      AND owner.rolname='postgres' AND p.prosecdef AND p.provolatile='v'
      AND 'search_path=public'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected claim-chain owner/security/search_path contract';
  END IF;

  SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure) INTO v_outer;
  SELECT pg_get_functiondef('public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure) INTO v_middle;
  SELECT pg_get_functiondef('public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure) INTO v_inner;
  IF position('public.node_tick_claim_without_boss_timing' IN v_outer)=0
     OR position('public.node_tick_claim_without_canary_gate' IN v_middle)=0 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected claim wrapper composition';
  END IF;
  IF position('''tank_candidates''' IN v_outer)>0 OR position('''tank_candidates''' IN v_middle)>0
     OR position('p.tank_id' IN v_outer)>0 OR position('p.tank_id' IN v_middle)>0
     OR position('p.leader_id' IN v_outer)>0 OR position('p.leader_id' IN v_middle)>0 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: tank ordering unexpectedly exists in a claim wrapper';
  END IF;
  IF position('''tank_candidates''' IN v_inner)=0
     OR position('nf.character_id = p.tank_id' IN v_inner)=0
     OR position('nf.character_id = p.leader_id' IN v_inner)=0
     OR (SELECT count(*) FROM regexp_matches(v_inner,v_case_pattern,'g'))<>1
     OR (SELECT count(*) FROM regexp_matches(v_inner,v_order_pattern,'g'))<>1 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected inner tank-candidate predecessor';
  END IF;
  IF has_function_privilege('anon','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')
     OR has_function_privilege('anon','public.node_tick_claim_without_boss_timing(uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.node_tick_claim_without_boss_timing(uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('postgres','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid='public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure
         AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected inner claim ACL';
  END IF;
END;
$$;

-- Trigger-only entry implementation. It deliberately has no caller-ownership
-- check: the caller is the authoritative movement transaction, proved by the
-- transaction-local movement marker and protected by service-only ACLs.
CREATE FUNCTION public.combat2_arrive_after_relocation(
  _character_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  prior public.node_pending_event; e public.node_encounter; f public.node_fighter;
  v_node uuid; v_check uuid; v_party uuid; v_group uuid; v_fighter uuid;
  v_seq bigint; v_generation bigint; v_event uuid; v_version bigint;
  v_parties uuid[]; v_reentry boolean:=false; v_reactivated boolean:=false;
BEGIN
  IF COALESCE(current_setting('app.combat2_depart_authorized',true),'')<>'true' THEN
    RETURN jsonb_build_object('ok',false,'kind','not_authorized');
  END IF;
  IF NOT public.combat_mode_is_open() THEN
    RETURN jsonb_build_object('ok',false,'kind','mode_refused','reason','maintenance');
  END IF;
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request'); END IF;
  SELECT * INTO prior FROM public.node_pending_event WHERE request_id=_request_id;
  IF FOUND THEN
    IF prior.actor_character_id IS DISTINCT FROM _character_id OR prior.event_type<>'fighter_entered' THEN
      RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_conflict');
    END IF;
    RETURN jsonb_build_object('ok',true,'kind','already_entered','encounter_id',prior.encounter_id,
      'event_id',prior.id,'fighter_id',prior.payload->>'fighter_id','entry_seq',(prior.payload->>'entry_seq')::bigint);
  END IF;

  SELECT current_node_id INTO v_node FROM public.characters WHERE id=_character_id AND hp>0;
  IF v_node IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_living_at_node'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||v_node::text,0));
  SELECT current_node_id INTO v_check FROM public.characters WHERE id=_character_id AND hp>0 FOR UPDATE;
  IF v_check IS DISTINCT FROM v_node THEN RETURN jsonb_build_object('ok',false,'kind','node_changed'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.creatures c
    WHERE c.node_id=v_node AND c.is_alive AND c.is_aggressive
  ) AND NOT EXISTS (
    SELECT 1 FROM public.node_encounter active_e
    JOIN public.node_creature active_nc ON active_nc.encounter_id=active_e.id
    WHERE active_e.node_id=v_node AND active_e.status='active'
      AND active_nc.is_alive AND active_nc.engaged
  ) THEN
    RETURN jsonb_build_object('ok',false,'kind','no_engagement');
  END IF;

  SELECT array_agg(pm.party_id ORDER BY pm.party_id) INTO v_parties
  FROM public.party_members pm WHERE pm.character_id=_character_id AND pm.status='accepted';
  IF cardinality(v_parties)>1 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: ambiguous accepted party membership for %',_character_id;
  END IF;
  v_party:=v_parties[1];

  SELECT * INTO e FROM public.node_encounter WHERE node_id=v_node FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.node_encounter(node_id,status,next_due_at)
      VALUES(v_node,'active',now()) RETURNING * INTO e;
  ELSIF e.status<>'active' THEN
    v_reactivated:=true;
    UPDATE public.node_fighter SET present=false,left_at=COALESCE(left_at,now()),updated_at=now()
      WHERE encounter_id=e.id AND present;
    UPDATE public.node_arrival_group SET active=false,deactivated_at=now()
      WHERE encounter_id=e.id AND active;
    UPDATE public.node_creature SET tank_fighter_id=NULL,engaged=false,updated_at=now()
      WHERE encounter_id=e.id AND is_alive;
    UPDATE public.node_intent SET status='rejected',reject_reason='stale_generation'
      WHERE encounter_id=e.id AND status='pending';
    UPDATE public.node_pending_event SET consumed_at=now(),consumed_tick=e.tick
      WHERE encounter_id=e.id AND consumed_at IS NULL;
    UPDATE public.node_encounter SET status='active',next_due_at=now(),claim_token=NULL,
      claimed_tick=NULL,claim_expires_at=NULL,intent_cutoff_seq=NULL,updated_at=now()
      WHERE id=e.id RETURNING * INTO e;
  END IF;
  PERFORM public.combat2_seed_spawns(e.id,v_node);

  IF v_party IS NULL THEN
    SELECT COALESCE(MAX(g.generation),0)+1 INTO v_generation
      FROM public.node_arrival_group g WHERE g.encounter_id=e.id AND g.party_id IS NULL;
    INSERT INTO public.node_arrival_group(encounter_id,party_id,generation)
      VALUES(e.id,NULL,v_generation) RETURNING id INTO v_group;
  ELSE
    SELECT g.id INTO v_group FROM public.node_arrival_group g
      WHERE g.encounter_id=e.id AND g.party_id=v_party AND g.active
      ORDER BY g.arrival_seq DESC,g.id DESC LIMIT 1;
    IF v_group IS NULL THEN
      SELECT COALESCE(MAX(g.generation),0)+1 INTO v_generation
        FROM public.node_arrival_group g WHERE g.encounter_id=e.id AND g.party_id=v_party;
      INSERT INTO public.node_arrival_group(encounter_id,party_id,generation)
        VALUES(e.id,v_party,v_generation) RETURNING id INTO v_group;
    END IF;
  END IF;

  SELECT nf.* INTO f FROM public.node_fighter nf
    WHERE nf.encounter_id=e.id AND nf.character_id=_character_id FOR UPDATE;
  IF FOUND AND f.present THEN
    RETURN jsonb_build_object('ok',false,'kind','already_present','encounter_id',e.id,
      'fighter_id',f.id,'entry_seq',f.entry_seq);
  END IF;
  v_seq:=nextval('node_fighter_entry_seq_seq');
  IF FOUND THEN
    v_reentry:=true;
    UPDATE public.node_fighter SET present=true,left_at=NULL,entry_seq=v_seq,joined_at=now(),
      party_id_at_entry=v_party,arrival_group_id=v_group,exit_request_id=NULL,updated_at=now()
      WHERE id=f.id RETURNING id INTO v_fighter;
  ELSE
    INSERT INTO public.node_fighter(encounter_id,character_id,entry_seq,present,party_id_at_entry,joined_at,arrival_group_id)
      VALUES(e.id,_character_id,v_seq,true,v_party,now(),v_group) RETURNING id INTO v_fighter;
  END IF;
  UPDATE public.node_creature nc SET engaged=true,updated_at=now()
    FROM public.creatures cr
    WHERE nc.encounter_id=e.id AND nc.creature_id=cr.id AND nc.is_alive
      AND cr.is_aggressive AND NOT nc.engaged;
  PERFORM public.combat2_refresh_tanks(e.id);
  INSERT INTO public.node_pending_event(encounter_id,event_type,actor_character_id,payload,request_id)
    VALUES(e.id,'fighter_entered',_character_id,jsonb_build_object('fighter_id',v_fighter,'node_id',v_node,
      'entry_seq',v_seq,'arrival_group_id',v_group,'reentry',v_reentry,'reactivated',v_reactivated),_request_id)
    RETURNING id INTO v_event;
  UPDATE public.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,
    claim_expires_at=NULL,intent_cutoff_seq=NULL,updated_at=now()
    WHERE id=e.id RETURNING state_version INTO v_version;
  RETURN jsonb_build_object('ok',true,'kind',CASE WHEN v_reentry THEN 'reentered' ELSE 'entered' END,
    'encounter_id',e.id,'node_id',v_node,'reactivated',v_reactivated,'fighter_id',v_fighter,
    'entry_seq',v_seq,'event_id',v_event,'state_version',v_version);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_arrive_after_relocation(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat2_arrive_after_relocation(uuid,uuid) TO service_role;

CREATE FUNCTION public.combat2_authoritative_arrival_trigger()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_seed text; v_request uuid; v_result jsonb;
BEGIN
  IF OLD.current_node_id IS NOT DISTINCT FROM NEW.current_node_id OR NEW.hp<=0
     OR COALESCE(current_setting('app.combat2_depart_authorized',true),'')<>'true' THEN
    RETURN NEW;
  END IF;
  v_seed:=md5(NEW.id::text||':'||OLD.current_node_id::text||':'||NEW.current_node_id::text||':'||txid_current()::text);
  v_request:=(substr(v_seed,1,8)||'-'||substr(v_seed,9,4)||'-4'||substr(v_seed,14,3)||'-8'||substr(v_seed,18,3)||'-'||substr(v_seed,21,12))::uuid;
  v_result:=public.combat2_arrive_after_relocation(NEW.id,v_request);
  IF v_result->>'ok'='false' AND v_result->>'kind' NOT IN ('no_engagement','mode_refused','already_present') THEN
    RAISE EXCEPTION 'ENG-COMBAT-002 arrival failed closed: %',v_result->>'kind';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_authoritative_arrival_trigger()
  FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS combat2_authoritative_arrival ON public.characters;
CREATE TRIGGER combat2_authoritative_arrival
AFTER UPDATE OF current_node_id ON public.characters
FOR EACH ROW EXECUTE FUNCTION public.combat2_authoritative_arrival_trigger();

-- All ordinary movement callers acquire origin and destination node locks in
-- UUID order before the existing encounter/character locks. This makes the
-- relocation trigger's destination entry lock re-entrant and prevents two
-- opposite-direction movements from reversing the node pair.
CREATE OR REPLACE FUNCTION public.combat2_depart(
  _character_id uuid,_destination_node_id uuid,_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE origin uuid; locked_node uuid;
BEGIN
  SELECT current_node_id INTO origin FROM public.characters WHERE id=_character_id;
  IF NOT public.combat2_movement_scope_eligible(origin,_destination_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','destination_not_enabled');
  END IF;
  FOR locked_node IN SELECT node_id FROM (VALUES(origin),(_destination_node_id)) nodes(node_id)
    WHERE node_id IS NOT NULL GROUP BY node_id ORDER BY node_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_node::text,0));
  END LOOP;
  RETURN public.combat2_depart_without_canary_gate(_character_id,_destination_node_id,_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_depart(uuid,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.combat2_party_depart(
  _leader_character_id uuid,_destination_node_id uuid,_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE origin uuid; locked_node uuid;
BEGIN
  SELECT current_node_id INTO origin FROM public.characters WHERE id=_leader_character_id;
  IF NOT public.combat2_movement_scope_eligible(origin,_destination_node_id) THEN
    RETURN jsonb_build_object('ok',false,'kind','scope_refused','reason','destination_not_enabled');
  END IF;
  FOR locked_node IN SELECT node_id FROM (VALUES(origin),(_destination_node_id)) nodes(node_id)
    WHERE node_id IS NOT NULL GROUP BY node_id ORDER BY node_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_node::text,0));
  END LOOP;
  RETURN public.combat2_party_depart_without_canary_gate(_leader_character_id,_destination_node_id,_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_party_depart(uuid,uuid,uuid) TO authenticated,service_role;

-- Queued departures relocate inside commit. Lock the origin/destination node
-- set before the preserved commit takes its encounter/character row locks.
ALTER FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
  RENAME TO node_tick_commit_without_authoritative_arrival;
REVOKE ALL ON FUNCTION public.node_tick_commit_without_authoritative_arrival(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit_without_authoritative_arrival(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
  TO service_role;

CREATE FUNCTION public.node_tick_commit(
  _encounter_id uuid,_claim_token uuid,_candidate_tick integer,_expected_last_tick integer,
  _expected_state_version bigint,_intent_ids uuid[],_proposed jsonb
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE locked_node uuid;
BEGIN
  FOR locked_node IN
    SELECT node_id FROM (
      SELECT e.node_id FROM public.node_encounter e WHERE e.id=_encounter_id
      UNION
      SELECT (departure->>'destination_node_id')::uuid
      FROM jsonb_array_elements(COALESCE(_proposed->'departures','[]'::jsonb)) departure
      WHERE departure->>'outcome'='moved'
    ) nodes WHERE node_id IS NOT NULL ORDER BY node_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_node::text,0));
  END LOOP;
  RETURN public.node_tick_commit_without_authoritative_arrival(
    _encounter_id,_claim_token,_candidate_tick,_expected_last_tick,
    _expected_state_version,_intent_ids,_proposed);
END;
$$;
REVOKE ALL ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)
  TO service_role;

-- Normalize the public intent boundary to the same node -> encounter ->
-- per-character intent -> character order used by entry and movement. The
-- preserved predecessor still owns replay, CP, target and queue semantics.
ALTER FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)
  RENAME TO combat_intent_without_global_lock_order;
REVOKE ALL ON FUNCTION public.combat_intent_without_global_lock_order(uuid,uuid,text,text,text,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.combat_intent_without_global_lock_order(uuid,uuid,text,text,text,uuid,uuid,uuid)
  TO service_role;

CREATE FUNCTION public.combat_intent(
  _encounter_id uuid,_character_id uuid,_intent_kind text,_ability_key text,
  _stance_key text,_target_creature_id uuid,_target_character_id uuid,_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_node uuid; locked_encounter public.node_encounter;
BEGIN
  SELECT e.node_id INTO v_node FROM public.node_encounter e WHERE e.id=_encounter_id;
  IF v_node IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||v_node::text,0));
    SELECT * INTO locked_encounter FROM public.node_encounter e WHERE e.id=_encounter_id FOR UPDATE;
  END IF;
  RETURN public.combat_intent_without_global_lock_order(
    _encounter_id,_character_id,_intent_kind,_ability_key,_stance_key,
    _target_creature_id,_target_character_id,_request_id);
END;
$$;
REVOKE ALL ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)
  TO authenticated,service_role;

-- One browser-callable boundary for Basic Attack or any authored enemy-targeted
-- ability. The server derives hostility from the active authored catalogue row.
CREATE FUNCTION public.combat2_hostile_action(
  _character_id uuid,
  _intent_kind text,
  _ability_key text,
  _target_creature_id uuid,
  _request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_node uuid; v_class text;
  v_entry jsonb; v_intent jsonb; v_target_type text; v_activation text;
  v_existing public.node_intent; v_existing_fighter public.node_fighter;
BEGIN
  IF _request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','invalid_request','reason','request_id_required'); END IF;
  IF NOT public.owns_character(_character_id) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
  SELECT current_node_id,class INTO v_node,v_class FROM public.characters WHERE id=_character_id AND hp>0;
  IF v_node IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_living_at_node'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||v_node::text,0));
  SELECT c.current_node_id,c.class INTO v_node,v_class FROM public.characters c
    WHERE c.id=_character_id AND c.hp>0 AND c.current_node_id=v_node;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','node_changed'); END IF;

  -- A request that already reached the authoritative intent ledger must replay
  -- or conflict there before current catalogue classification is considered.
  -- The node advisory lock serializes this lookup with both this function and
  -- the public combat_intent wrapper without widening the lock order.
  SELECT * INTO v_existing FROM public.node_intent i WHERE i.request_id=_request_id;
  IF FOUND THEN
    v_intent:=public.combat_intent(v_existing.encounter_id,_character_id,_intent_kind,
      _ability_key,NULL,_target_creature_id,NULL,_request_id);
    IF v_intent->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_intent; END IF;
    SELECT * INTO v_existing_fighter FROM public.node_fighter f
      WHERE f.encounter_id=v_existing.encounter_id AND f.character_id=_character_id;
    RETURN v_intent||jsonb_build_object('encounter_id',v_existing.encounter_id,
      'fighter_id',v_existing_fighter.id,'entry_seq',v_existing_fighter.entry_seq,
      'entry_kind','already_entered');
  END IF;

  IF _intent_kind NOT IN ('basic_attack','ability')
     OR (_intent_kind='basic_attack' AND _ability_key IS NOT NULL)
     OR (_intent_kind='ability' AND _ability_key IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'kind','non_hostile_action');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.creatures c WHERE c.id=_target_creature_id AND c.node_id=v_node AND c.is_alive) THEN
    RETURN jsonb_build_object('ok',false,'kind','invalid_target');
  END IF;
  IF _intent_kind='ability' THEN
    SELECT a.target_type,a.activation_mode INTO v_target_type,v_activation
    FROM public.class_ability_assignments ca
    JOIN public.abilities a ON a.id=ca.ability_id
    WHERE ca.class_key=v_class AND ca.status='active' AND a.status='active'
      AND (ca.class_ability_key=_ability_key OR a.ability_key=_ability_key)
    ORDER BY (ca.class_ability_key=_ability_key) DESC,ca.unlock_level DESC,a.id
    LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'kind','ability_unavailable'); END IF;
    IF v_target_type<>'enemy' OR v_activation='stance' THEN
      RETURN jsonb_build_object('ok',false,'kind','non_hostile_action');
    END IF;
  END IF;

  BEGIN
    v_entry:=public.combat_enter_without_engagement_gate(_character_id,_request_id);
    IF NOT ((v_entry->>'ok'='true' AND v_entry->>'kind' IN ('entered','reentered','already_entered'))
      OR (v_entry->>'ok'='false' AND v_entry->>'kind'='already_present')) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=COALESCE(v_entry->>'kind','entry_refused');
    END IF;
    v_intent:=public.combat_intent((v_entry->>'encounter_id')::uuid,_character_id,_intent_kind,
      _ability_key,NULL,_target_creature_id,NULL,_request_id);
    IF v_intent->>'ok' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=COALESCE(v_intent->>'kind','intent_refused');
    END IF;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('ok',false,'kind',SQLERRM);
  END;
  RETURN v_intent||jsonb_build_object('encounter_id',v_entry->>'encounter_id',
    'fighter_id',v_entry->>'fighter_id','entry_seq',(v_entry->>'entry_seq')::bigint,
    'entry_kind',v_entry->>'kind');
END;
$$;
REVOKE ALL ON FUNCTION public.combat2_hostile_action(uuid,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_hostile_action(uuid,text,text,uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.combat2_engage(_character_id uuid,_target_creature_id uuid,_request_id uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT public.combat2_hostile_action(_character_id,'basic_attack',NULL,_target_creature_id,_request_id)
$$;
REVOKE ALL ON FUNCTION public.combat2_engage(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.combat2_engage(uuid,uuid,uuid) TO authenticated,service_role;

-- Remove party-role priority. The resolver consumes candidates in this order;
-- entry_seq is globally monotonic and character UUID is the deterministic tie.
-- Only the installed inner snapshot builder is rewritten; both wrappers and
-- every function metadata/ACL property are captured and proved unchanged.
DO $$
DECLARE
  d text; before text; outer_before text; middle_before text;
  case_pattern text := 'CASE\s+WHEN g\.party_id IS NULL THEN 0\s+WHEN nf\.character_id = p\.tank_id THEN 0\s+WHEN nf\.character_id = p\.leader_id THEN 1\s+ELSE 2\s+END AS member_priority';
  order_pattern text := 'representative\.arrival_seq\s+DESC,\s*representative\.group_id\s+DESC,\s*representative\.member_priority,\s*representative\.entry_seq\s+DESC,\s*representative\.fighter_id\s+DESC';
  inner_owner oid; inner_security boolean; inner_volatility "char"; inner_config text[]; inner_acl aclitem[];
  middle_owner oid; middle_security boolean; middle_volatility "char"; middle_config text[]; middle_acl aclitem[];
  outer_owner oid; outer_security boolean; outer_volatility "char"; outer_config text[]; outer_acl aclitem[];
BEGIN
  SELECT pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure),
         p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
    INTO outer_before,outer_owner,outer_security,outer_volatility,outer_config,outer_acl
    FROM pg_proc p WHERE p.oid='public.node_tick_claim(uuid,integer)'::regprocedure;
  SELECT pg_get_functiondef('public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure),
         p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
    INTO middle_before,middle_owner,middle_security,middle_volatility,middle_config,middle_acl
    FROM pg_proc p WHERE p.oid='public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure;
  SELECT pg_get_functiondef('public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure),
         p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
    INTO d,inner_owner,inner_security,inner_volatility,inner_config,inner_acl
    FROM pg_proc p WHERE p.oid='public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure;
  before:=d;
  IF (SELECT count(*) FROM regexp_matches(d,case_pattern,'g'))<>1
     OR (SELECT count(*) FROM regexp_matches(d,order_pattern,'g'))<>1 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: inner tank-order predecessor must match exactly once';
  END IF;
  d:=regexp_replace(d,
    case_pattern,
    '0 AS member_priority');
  d:=regexp_replace(d,
    order_pattern,
    'representative.entry_seq DESC, representative.character_id DESC');
  IF d=before OR position('nf.character_id = p.tank_id' IN d)>0
     OR position('nf.character_id = p.leader_id' IN d)>0
     OR position('representative.entry_seq DESC, representative.character_id DESC' IN d)=0
     OR (SELECT count(*) FROM regexp_matches(d,case_pattern,'g'))<>0
     OR (SELECT count(*) FROM regexp_matches(d,order_pattern,'g'))<>0 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: tank-candidate transformation failed';
  END IF;
  EXECUTE d;

  IF pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure)<>outer_before
     OR pg_get_functiondef('public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure)<>middle_before
     OR position('public.node_tick_claim_without_boss_timing' IN pg_get_functiondef('public.node_tick_claim(uuid,integer)'::regprocedure))=0
     OR position('public.node_tick_claim_without_canary_gate' IN pg_get_functiondef('public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: claim wrapper changed or composition was lost';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure
      AND p.proowner=inner_owner AND p.prosecdef=inner_security AND p.provolatile=inner_volatility
      AND p.proconfig IS NOT DISTINCT FROM inner_config AND p.proacl IS NOT DISTINCT FROM inner_acl
      AND 'search_path=public'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.node_tick_claim_without_boss_timing(uuid,integer)'::regprocedure
      AND p.proowner=middle_owner AND p.prosecdef=middle_security AND p.provolatile=middle_volatility
      AND p.proconfig IS NOT DISTINCT FROM middle_config AND p.proacl IS NOT DISTINCT FROM middle_acl
      AND 'search_path=public, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid='public.node_tick_claim(uuid,integer)'::regprocedure
      AND p.proowner=outer_owner AND p.prosecdef=outer_security AND p.provolatile=outer_volatility
      AND p.proconfig IS NOT DISTINCT FROM outer_config AND p.proacl IS NOT DISTINCT FROM outer_acl
      AND 'search_path=public, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: claim-chain metadata or ACL changed';
  END IF;
  IF has_function_privilege('anon','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.node_tick_claim_without_canary_gate(uuid,integer)','EXECUTE')
     OR has_function_privilege('anon','public.node_tick_claim_without_boss_timing(uuid,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.node_tick_claim_without_boss_timing(uuid,integer)','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid='public.node_tick_claim_without_canary_gate(uuid,integer)'::regprocedure
         AND acl.grantee=0 AND acl.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: browser access gained on inner claim';
  END IF;
END;
$$;

DO $$
DECLARE signature regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.combat2_arrive_after_relocation(uuid,uuid)'::regprocedure,
    'public.combat2_authoritative_arrival_trigger()'::regprocedure,
    'public.combat2_hostile_action(uuid,text,text,uuid,uuid)'::regprocedure,
    'public.combat2_engage(uuid,uuid,uuid)'::regprocedure,
    'public.combat2_depart(uuid,uuid,uuid)'::regprocedure,
    'public.combat2_party_depart(uuid,uuid,uuid)'::regprocedure,
    'public.combat_intent(uuid,uuid,text,text,text,uuid,uuid,uuid)'::regprocedure,
    'public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
      WHERE p.oid=signature AND owner.rolname='postgres' AND p.prosecdef
        AND 'search_path=public, pg_temp'=ANY(COALESCE(p.proconfig,ARRAY[]::text[]))
    ) THEN
      RAISE EXCEPTION 'ENG-COMBAT-002: unexpected owner/security/search_path for %',signature;
    END IF;
  END LOOP;

  IF has_function_privilege('anon','public.combat2_hostile_action(uuid,text,text,uuid,uuid)','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid='public.combat2_hostile_action(uuid,text,text,uuid,uuid)'::regprocedure
         AND acl.grantee=0 AND acl.privilege_type='EXECUTE')
     OR NOT has_function_privilege('authenticated','public.combat2_hostile_action(uuid,text,text,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.combat2_hostile_action(uuid,text,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.combat2_arrive_after_relocation(uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.combat2_arrive_after_relocation(uuid,uuid)','EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid='public.combat2_arrive_after_relocation(uuid,uuid)'::regprocedure
         AND acl.grantee=0 AND acl.privilege_type='EXECUTE')
     OR NOT has_function_privilege('service_role','public.combat2_arrive_after_relocation(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ENG-COMBAT-002: unexpected public/internal function ACL';
  END IF;
END;
$$;

COMMIT;