-- LOCAL / NON-DEPLOYABLE. Uses unchanged G4A6 accounting and G4A12 full source.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'G4A13 private fixture only'; END IF; END $$;
CREATE SCHEMA g4a13;
CREATE FUNCTION g4a13.discover(cl jsonb,proposal jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH origin AS (SELECT e.id,e.node_id FROM g4a6.node_encounter e WHERE e.id=(cl->>'encounter_id')::uuid),
 moves AS (SELECT (v->>'destination_node_id')::uuid node_id,(v->>'request_id')::uuid request_id FROM jsonb_array_elements(coalesce(proposal->'departures','[]')) v WHERE v->>'outcome'='moved'),
 actors AS (SELECT f.character_id id FROM g4a6.node_fighter f WHERE f.encounter_id IN(SELECT id FROM origin)
 UNION SELECT d.character_id FROM g4a6.combat2_departure_request d JOIN moves m ON m.request_id=d.request_id),
 parties AS (SELECT p.id,p.leader_id,p.tank_id FROM g4a6.parties p WHERE p.leader_id IN(SELECT id FROM actors)
 OR EXISTS(SELECT 1 FROM g4a6.party_members m WHERE m.party_id=p.id AND m.character_id IN(SELECT id FROM actors))),
 members AS (SELECT m.id,m.party_id,m.character_id,m.status,m.is_following FROM g4a6.party_members m WHERE m.party_id IN(SELECT id FROM parties)),
 chars AS (SELECT c.id,c.current_node_id,c.deleted_at FROM g4a6.characters c WHERE c.id IN(SELECT id FROM actors UNION SELECT character_id FROM members)),
 touched AS (SELECT node_id FROM origin UNION SELECT node_id FROM moves),
 creatures AS (SELECT c.id,c.node_id,c.spawn_seq FROM g4a6.creatures c WHERE c.node_id IN(SELECT node_id FROM touched)
 OR EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq AND e.node_id IN(SELECT node_id FROM touched))),
 refs AS (SELECT f.encounter_id id FROM g4a6.node_fighter f WHERE f.character_id IN(SELECT id FROM chars)
 UNION SELECT nc.encounter_id FROM g4a6.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
 UNION SELECT g.encounter_id FROM g4a6.node_arrival_group g WHERE g.active AND g.party_id IN(SELECT id FROM parties)),
 encounters AS (SELECT e.id,e.node_id FROM g4a6.node_encounter e WHERE e.node_id IN(SELECT node_id FROM touched UNION SELECT current_node_id FROM chars) OR e.id IN(SELECT id FROM refs)),
 nodes AS (SELECT node_id id FROM touched UNION SELECT current_node_id FROM chars UNION SELECT node_id FROM encounters UNION SELECT node_id FROM creatures)
 SELECT jsonb_build_object('nodes',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM nodes WHERE id IS NOT NULL),'[]'),
 'touched',coalesce((SELECT jsonb_agg(node_id ORDER BY node_id) FROM touched WHERE node_id IS NOT NULL),'[]'),
 'parties',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM parties p),'[]'),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM members m),'[]'),
 'characters',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM chars c),'[]'),
 'encounters',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM encounters e),'[]'),
 'creatures',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM creatures c),'[]'),
 'projections',coalesce((SELECT jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id) FROM g4a6.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq),'[]'))
$$;
CREATE FUNCTION g4a13.cover(cl jsonb,proposal jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE coverage jsonb:=g4a13.discover(cl,proposal); n uuid;
BEGIN
 FOR n IN SELECT value::uuid FROM jsonb_array_elements_text(coverage->'nodes') ORDER BY value::uuid LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 IF coverage IS DISTINCT FROM g4a13.discover(cl,proposal) THEN RAISE EXCEPTION 'coverage changed before encounter locks' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM g4a6.node_encounter WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'encounters') v) ORDER BY id FOR UPDATE;
 IF coverage IS DISTINCT FROM g4a13.discover(cl,proposal) THEN RAISE EXCEPTION 'coverage changed under encounters' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq JOIN g4a6.node_encounter e ON e.id=nc.encounter_id
 WHERE c.id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v) AND c.node_id IS DISTINCT FROM e.node_id)
 THEN RAISE EXCEPTION 'inconsistent retained projection; no repair' USING ERRCODE='40001'; END IF;
 -- Lock only the discovered rows directly: never let a helper discover a new
 -- node between coverage validation and its own dependent-row read.
 PERFORM 1 FROM g4a6.node_creature WHERE id IN(SELECT (v->>0)::uuid FROM jsonb_array_elements(coverage->'projections') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM g4a6.creatures WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v) ORDER BY id FOR UPDATE;
 IF coverage IS DISTINCT FROM g4a13.discover(cl,proposal) THEN RAISE EXCEPTION 'coverage changed under dependent locks' USING ERRCODE='40001'; END IF;
 PERFORM set_config('g4a13.last_coverage',coverage::text,true);
 RETURN coverage;
END $$;
CREATE FUNCTION g4a13.commit_result(cl jsonb,proposal jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE coverage jsonb; cid uuid; result jsonb; origin uuid; e g4a6.node_encounter;
BEGIN
 SELECT node_id INTO STRICT origin FROM g4a6.node_encounter WHERE id=(cl->>'encounter_id')::uuid;
 coverage:=g4a13.cover(cl,proposal);
 SELECT * INTO STRICT e FROM g4a6.node_encounter WHERE id=(cl->>'encounter_id')::uuid;
 IF e.node_id IS DISTINCT FROM origin THEN RAISE EXCEPTION 'origin coverage changed' USING ERRCODE='40001'; END IF;
 IF e.tick<(cl->>'candidate_tick')::integer AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(proposal->'creatures','[]')) v JOIN g4a6.creatures c ON c.id=(v->>'creature_id')::uuid WHERE c.spawn_seq<>(v->>'spawn_seq')::integer)
 THEN RETURN jsonb_build_object('ok',false,'kind','stale_snapshot'); END IF;
 BEGIN
 -- Existing replay must not settle a destination for a second time. Preserve the
 -- complete source stance-before-inner-replay behavior, including refusals.
 IF e.tick<(cl->>'candidate_tick')::integer THEN
  FOR cid IN SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v WHERE (v->>'node_id')::uuid<>origin ORDER BY (v->>'id')::uuid LOOP
   -- A successful authoritative arrival will invalidate this destination lease.
   -- Fence before old quiet-time settlement; all changes roll back on refusal.
   UPDATE g4a6.node_encounter SET claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL WHERE id IN(SELECT nc.encounter_id FROM g4a6.node_creature nc JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq WHERE c.id=cid);
   PERFORM g4a6.settle(cid,g4a6.test_now());
  END LOOP;
 END IF;
 result:=g4a6.node_tick_commit((cl->>'encounter_id')::uuid,(cl->>'claim_token')::uuid,(cl->>'candidate_tick')::int,
 (cl->>'last_committed_tick')::int,(cl->>'state_version')::bigint,ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(proposal->'intent_ids')),proposal);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'commit refusal rollback' USING ERRCODE='P1013'; END IF;
 IF result->>'kind'='committed' THEN
  FOR cid IN SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v ORDER BY (v->>'id')::uuid LOOP PERFORM g4a6.reconcile(cid,g4a6.test_now()); END LOOP;
 END IF;
 EXCEPTION WHEN SQLSTATE 'P1013' THEN RETURN result;
 END;
 RETURN result;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a13 FROM PUBLIC;
