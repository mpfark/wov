-- LOCAL / NON-DEPLOYABLE integration wrappers. Source bodies are generated from
-- pinned repository definitions, not handwritten replacements or public RPCs.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE FUNCTION g4a6.combat2_seed_spawns(eid uuid,node uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE cid uuid;
BEGIN
 FOR cid IN SELECT id FROM g4a6.creatures WHERE node_id=node ORDER BY id LOOP
   PERFORM g4a6.settle(cid,g4a6.test_now());
 END LOOP;
 PERFORM g4a6.src_seed(eid,node);
END $$;

CREATE FUNCTION g4a7.enter(actor uuid,request uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE cid uuid; result jsonb;
BEGIN
 IF NOT g4a6.owns_character(actor) OR request IS NULL OR EXISTS(SELECT 1 FROM g4a6.node_pending_event WHERE request_id=request)
 THEN RETURN g4a6.src_enter(actor,request); END IF;
 -- Bounded fixture: exactly one creature on this node. Multi-creature/node
 -- pre-discovery and real movement/lifecycle triggers are not claimed covered.
 SELECT c.id INTO STRICT cid FROM g4a6.creatures c JOIN g4a6.characters a ON a.current_node_id=c.node_id WHERE a.id=actor;
 BEGIN
   PERFORM g4a6.lock_creature(cid);
   -- A newly accepted authoritative entry invalidates the old lease anyway.
   -- Fence it before settling proved quiet time, or passive deferral would lose
   -- earned whole HP when post-entry reconciliation closes that interval.
   UPDATE g4a6.node_encounter SET claim_token=NULL,claim_expires_at=NULL,claimed_tick=NULL
   WHERE node_id=(SELECT node_id FROM g4a6.creatures WHERE id=cid);
   PERFORM g4a6.settle(cid,g4a6.test_now());
   result:=g4a6.src_enter(actor,request);
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'adapter refusal' USING ERRCODE='P0001'; END IF;
   PERFORM g4a6.reconcile(cid,g4a6.test_now());
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF result IS NULL THEN RAISE; END IF; RETURN result;
 END;
 RETURN result;
END $$;
CREATE FUNCTION g4a6.combat_enter_without_engagement_gate(actor uuid,request uuid) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,g4a6,pg_temp AS $$ SELECT g4a7.enter(actor,request) $$;

CREATE FUNCTION g4a7.claim(cid uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE result jsonb; node uuid;
BEGIN
 BEGIN
   PERFORM g4a6.lock_creature(cid);PERFORM g4a6.settle(cid,g4a6.test_now());
   SELECT node_id INTO STRICT node FROM g4a6.creatures WHERE id=cid;
   PERFORM g4a6.combat2_seed_spawns((SELECT id FROM g4a6.node_encounter WHERE node_id=node),node);
   result:=g4a6.src_claim(node,5000);
   IF result->>'kind'<>'claimed' THEN RAISE EXCEPTION 'claim refusal' USING ERRCODE='P0001'; END IF;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF result IS NULL THEN RAISE; END IF; RETURN result;
 END;
 RETURN result;
END $$;

CREATE FUNCTION g4a7.commit_result(cid uuid,claim jsonb,proposal jsonb,intents uuid[]) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF claim->>'claim_token' IS NULL OR claim->>'state_version' IS NULL OR claim->>'candidate_tick' IS NULL THEN RAISE EXCEPTION 'incomplete metadata'; END IF;
 -- Deliberately reject reward/character/departure/proc/effect-insert/update paths
 -- that this source-fragment fixture does not execute faithfully.
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(proposal) k WHERE k NOT IN('creatures','effects_delete','pending_event_ids','status')) THEN RAISE EXCEPTION 'unsupported fragment path'; END IF;
 BEGIN
   PERFORM g4a6.lock_creature(cid);
   IF (SELECT tick FROM g4a6.node_encounter WHERE id=(claim->>'encounter_id')::uuid)<(claim->>'candidate_tick')::integer
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(proposal->'creatures','[]'::jsonb)) p
        JOIN g4a6.creatures c ON c.id=(p->>'creature_id')::uuid WHERE c.spawn_seq IS DISTINCT FROM (p->>'spawn_seq')::integer)
   THEN RETURN jsonb_build_object('ok',false,'kind','stale_generation'); END IF;
   result:=g4a6.src_commit_fragment((claim->>'encounter_id')::uuid,(claim->>'claim_token')::uuid,
     (claim->>'candidate_tick')::integer,(claim->>'last_committed_tick')::integer,(claim->>'state_version')::bigint,intents,proposal);
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'commit refusal' USING ERRCODE='P0001'; END IF;
   IF result->>'kind'='committed' THEN PERFORM g4a6.reconcile(cid,g4a6.test_now()); END IF;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN IF result IS NULL THEN RAISE; END IF; RETURN result;
 END;
 RETURN result;
END $$;

CREATE FUNCTION g4a7.exit_combat(cid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
BEGIN
 -- Explicit departure double: the real solo/party/movement chain is NOT loaded.
 PERFORM g4a6.lock_creature(cid);
 UPDATE g4a6.node_fighter SET present=false WHERE encounter_id IN(SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=cid);
 UPDATE g4a6.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
 WHERE id IN(SELECT encounter_id FROM g4a6.node_creature WHERE creature_id=cid);
 PERFORM g4a6.reconcile(cid,g4a6.test_now());
END $$;

CREATE FUNCTION g4a7.edit_rate(cid uuid,rate text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
BEGIN
 PERFORM g4a6.edit_rate(cid,rate,g4a6.test_now());
 UPDATE g4a6.creatures SET fractional_credit=0,accounted_through=g4a6.test_now() WHERE id=cid;
 -- The accounting period is fresh; uninterrupted quiet eligibility is not a
 -- renewed combat event. No new delay is invented merely by changing the rate.
END $$;
CREATE FUNCTION g4a7.edit_max(cid uuid,new_max integer) RETURNS void
LANGUAGE sql SET search_path=pg_catalog,g4a6,pg_temp AS $$ SELECT g4a6.edit_max(cid,new_max,g4a6.test_now(),true) $$;

CREATE FUNCTION g4a7.respawn(cid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE old_generation integer;
BEGIN
 IF (SELECT count(*) FROM g4a6.creatures)<>1 THEN RAISE EXCEPTION 'single-creature source fixture only'; END IF;
 PERFORM g4a6.lock_creature(cid);SELECT spawn_seq INTO STRICT old_generation FROM g4a6.creatures WHERE id=cid;
 PERFORM g4a6.src_respawn();
 IF (SELECT spawn_seq FROM g4a6.creatures WHERE id=cid)<>old_generation THEN
   UPDATE g4a6.creatures SET eligible_since=g4a6.test_now(),accounted_through=g4a6.test_now(),fractional_credit=0 WHERE id=cid;
 END IF;
END $$;
CREATE FUNCTION g4a7.wake_or_regen(cid uuid) RETURNS text
LANGUAGE sql SET search_path=pg_catalog,g4a6,pg_temp AS $$ SELECT g4a6.settle(cid,g4a6.test_now()) $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a7 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;
