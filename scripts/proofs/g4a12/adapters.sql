-- LOCAL / NON-DEPLOYABLE candidate boundaries around complete extracted bodies.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_%' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE FUNCTION g4a12.cover(n uuid) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; before_state jsonb; after_state jsonb; cid uuid;
BEGIN
 SELECT coalesce(jsonb_agg(jsonb_build_array(id,node_id,spawn_seq) ORDER BY id),'[]') INTO before_state FROM g4a6.creatures WHERE node_id=n;
 PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 PERFORM 1 FROM g4a6.node_encounter WHERE node_id=n ORDER BY id FOR UPDATE;
 SELECT coalesce(jsonb_agg(jsonb_build_array(id,node_id,spawn_seq) ORDER BY id),'[]') INTO after_state FROM g4a6.creatures WHERE node_id=n;
 IF before_state IS DISTINCT FROM after_state THEN RAISE EXCEPTION 'coverage changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
 JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE (c.node_id=n OR e.node_id=n) AND c.node_id IS DISTINCT FROM e.node_id)
 THEN RAISE EXCEPTION 'foreign retained projection' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO ids FROM g4a6.creatures WHERE node_id=n;
 FOREACH cid IN ARRAY ids LOOP PERFORM g4a6.lock_creature(cid); END LOOP;
 RETURN ids;
END $$;
CREATE FUNCTION g4a12.claim(n uuid,lease integer DEFAULT 5000) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; cid uuid; result jsonb;
BEGIN
 ids:=g4a12.cover(n);
 BEGIN
  FOREACH cid IN ARRAY ids LOOP PERFORM g4a6.settle(cid,g4a6.test_now()); END LOOP;
  PERFORM g4a6.combat2_seed_spawns((SELECT id FROM g4a6.node_encounter WHERE node_id=n),n);
  result:=g4a6.node_tick_claim(n,lease);
  IF result->>'kind'<>'claimed' THEN RAISE EXCEPTION 'claim refused' USING ERRCODE='P1012'; END IF;
 EXCEPTION WHEN SQLSTATE 'P1012' THEN RETURN result;
 END;
 RETURN result;
END $$;
CREATE FUNCTION g4a12.commit_result(cl jsonb,proposal jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; cid uuid; result jsonb; n uuid; e g4a6.node_encounter;
BEGIN
 -- Multi-node commit proposals need broader early coverage; explicitly unsupported
 -- here instead of acquiring destination gates after dependent row locks.
 IF jsonb_array_length(coalesce(proposal->'departures','[]'))<>0 THEN RAISE EXCEPTION 'G4A12 multi-node commit adapter not exercised'; END IF;
 SELECT node_id INTO STRICT n FROM g4a6.node_encounter WHERE id=(cl->>'encounter_id')::uuid;
 ids:=g4a12.cover(n);
 SELECT * INTO e FROM g4a6.node_encounter WHERE id=(cl->>'encounter_id')::uuid;
 IF e.node_id IS DISTINCT FROM n THEN RAISE EXCEPTION 'encounter coverage changed' USING ERRCODE='40001'; END IF;
 IF e.tick<(cl->>'candidate_tick')::integer AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(coalesce(proposal->'creatures','[]')) v
 JOIN g4a6.creatures c ON c.id=(v->>'creature_id')::uuid WHERE c.spawn_seq<>(v->>'spawn_seq')::integer)
 THEN RETURN jsonb_build_object('ok',false,'kind','stale_snapshot'); END IF;
 BEGIN
 result:=g4a6.node_tick_commit((cl->>'encounter_id')::uuid,(cl->>'claim_token')::uuid,
 (cl->>'candidate_tick')::int,(cl->>'last_committed_tick')::int,(cl->>'state_version')::bigint,
 ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(proposal->'intent_ids')),proposal);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'commit refused' USING ERRCODE='P1012'; END IF;
 IF result->>'kind'='committed' THEN
  FOREACH cid IN ARRAY ids LOOP PERFORM g4a6.reconcile(cid,g4a6.test_now()); END LOOP;
 END IF;
 EXCEPTION WHEN SQLSTATE 'P1012' THEN RETURN result;
 END;
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a12 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;
