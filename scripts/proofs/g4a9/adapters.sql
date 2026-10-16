-- LOCAL / NON-DEPLOYABLE. Candidate coverage, not a new production writer.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE FUNCTION g4a9.discover(actor uuid,destination uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH chosen AS (SELECT p.id,p.leader_id,p.tank_id FROM g4a6.parties p WHERE p.leader_id=actor OR EXISTS(
  SELECT 1 FROM g4a6.party_members pm WHERE pm.party_id=p.id AND pm.character_id=actor AND pm.status='accepted')),
 members AS (SELECT pm.* FROM g4a6.party_members pm WHERE pm.party_id IN(SELECT id FROM chosen)),
 chars AS (SELECT c.id,c.current_node_id,c.deleted_at FROM g4a6.characters c WHERE c.id=actor OR c.id IN(SELECT character_id FROM members)),
 base AS (SELECT current_node_id id FROM chars UNION SELECT destination),
 creatures AS (SELECT c.id,c.node_id,c.spawn_seq FROM g4a6.creatures c WHERE c.node_id IN(SELECT id FROM base)),
 refs AS (SELECT nf.encounter_id id FROM g4a6.node_fighter nf WHERE nf.character_id IN(SELECT id FROM chars)
  UNION SELECT nc.encounter_id FROM g4a6.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
  UNION SELECT g.encounter_id FROM g4a6.node_arrival_group g WHERE g.active AND g.party_id IN(SELECT id FROM chosen)
  UNION SELECT d.encounter_id FROM g4a6.combat2_departure_request d WHERE d.status IN('pending','queued') AND d.character_id IN(SELECT id FROM chars)),
 encounters AS (SELECT e.id,e.node_id FROM g4a6.node_encounter e WHERE e.node_id IN(SELECT id FROM base) OR e.id IN(SELECT id FROM refs)),
 nodes AS (SELECT id FROM base WHERE id IS NOT NULL UNION SELECT node_id FROM encounters)
 SELECT jsonb_build_object('parties',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM chosen p),'[]'),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM members m),'[]'),
 'characters',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM chars c),'[]'),
 'creatures',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM creatures c),'[]'),
 'encounters',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM encounters e),'[]'),
 'nodes',coalesce((SELECT jsonb_agg(n.id ORDER BY n.id) FROM nodes n),'[]'))
$$;
CREATE FUNCTION g4a9.cover(actor uuid,destination uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE coverage jsonb:=g4a9.discover(actor,destination); n uuid;
BEGIN
 FOR n IN SELECT value::uuid FROM jsonb_array_elements_text(coverage->'nodes') ORDER BY value::uuid LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 IF coverage IS DISTINCT FROM g4a9.discover(actor,destination) THEN RAISE EXCEPTION 'coverage changed before rows' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM g4a6.node_encounter WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'encounters') v) ORDER BY id FOR UPDATE;
 IF coverage IS DISTINCT FROM g4a9.discover(actor,destination) THEN RAISE EXCEPTION 'coverage changed under encounters' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM g4a6.creatures c JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq
  JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v)
  AND c.node_id IS DISTINCT FROM e.node_id) THEN RAISE EXCEPTION 'cross-node projection requires disposition' USING ERRCODE='40001'; END IF;
 RETURN coverage;
END $$;
CREATE FUNCTION g4a9.account(coverage jsonb,settlement boolean,fence boolean DEFAULT false,reverse_input boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cid uuid; ids uuid[];
BEGIN
 SELECT array_agg((v->>'id')::uuid ORDER BY CASE WHEN reverse_input THEN (v->>'id')::uuid END DESC,(v->>'id')::uuid) INTO ids FROM jsonb_array_elements(coverage->'creatures') v;
 FOR cid IN SELECT DISTINCT unnest(ids) ORDER BY 1 LOOP
  -- A dependent helper must never discover an unheld node gate after rows.
  IF EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.node_encounter e ON e.id=nc.encounter_id JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
    WHERE c.id=cid AND NOT(coverage->'nodes' ? e.node_id::text)) THEN RAISE EXCEPTION 'late projection coverage' USING ERRCODE='40001'; END IF;
  PERFORM g4a6.lock_creature(cid);
  IF settlement THEN
   IF fence THEN UPDATE g4a6.node_encounter SET claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
    WHERE id IN(SELECT nc.encounter_id FROM g4a6.node_creature nc JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq WHERE c.id=cid); END IF;
   PERFORM g4a6.settle(cid,g4a6.test_now());
  ELSE PERFORM g4a6.reconcile(cid,g4a6.test_now()); END IF;
 END LOOP;
END $$;
CREATE FUNCTION g4a9.move(actor uuid,destination uuid,request uuid,party boolean DEFAULT false,finish boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE coverage jsonb; result jsonb; replay boolean; origin uuid;
BEGIN
 IF NOT g4a6.owns_character(actor) OR destination IS NULL OR request IS NULL THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 coverage:=g4a9.cover(actor,destination);
 SELECT current_node_id INTO origin FROM g4a6.characters WHERE id=actor;
 coverage:=jsonb_set(coverage,'{creatures}',coalesce((SELECT jsonb_agg(v ORDER BY v->>'id') FROM jsonb_array_elements(coverage->'creatures') v WHERE (v->>'node_id')::uuid IN(origin,destination)),'[]'));
 SELECT CASE WHEN party THEN EXISTS(SELECT 1 FROM g4a6.combat2_party_departure_request WHERE request_id=request)
  ELSE EXISTS(SELECT 1 FROM g4a6.combat2_departure_request WHERE request_id=request) END INTO replay;
 BEGIN
  IF NOT replay THEN PERFORM g4a9.account(coverage,true,true); END IF;
  IF party THEN
   IF finish THEN result:=g4a6.combat2_party_depart(actor,destination,request);
   ELSE result:=g4a6.combat2_party_depart_without_immediate_transition(actor,destination,request); END IF;
  ELSE
   IF finish THEN result:=g4a6.combat2_depart(actor,destination,request);
   ELSE result:=g4a6.combat2_depart_without_immediate_transition(actor,destination,request); END IF;
  END IF;
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'rollback refusal' USING ERRCODE='P1009'; END IF;
  IF NOT replay OR result->>'kind'='moved' THEN PERFORM g4a9.account(coverage,false); END IF;
 EXCEPTION WHEN SQLSTATE 'P1009' THEN RETURN result;
 END;
 RETURN result;
END $$;
CREATE FUNCTION g4a9.entry(actor uuid,request uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE coverage jsonb; result jsonb; destination uuid;
BEGIN
 IF NOT g4a6.owns_character(actor) THEN RETURN jsonb_build_object('ok',false,'kind','not_authorized'); END IF;
 SELECT current_node_id INTO destination FROM g4a6.characters WHERE id=actor;
 coverage:=g4a9.cover(actor,destination);
 coverage:=jsonb_set(coverage,'{creatures}',coalesce((SELECT jsonb_agg(v ORDER BY v->>'id') FROM jsonb_array_elements(coverage->'creatures') v WHERE (v->>'node_id')::uuid=destination),'[]'));
 IF EXISTS(SELECT 1 FROM g4a6.node_pending_event WHERE request_id=request) THEN RETURN g4a6.src_enter(actor,request); END IF;
 BEGIN
  PERFORM g4a9.account(coverage,true,true); result:=g4a6.src_enter(actor,request);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'entry refusal' USING ERRCODE='P1009'; END IF;
  PERFORM g4a9.account(coverage,false);
 EXCEPTION WHEN SQLSTATE 'P1009' THEN RETURN result;
 END;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION g4a6.combat_enter_without_engagement_gate(actor uuid,request uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT g4a9.entry(actor,request) $$;
CREATE FUNCTION g4a9.arrive(actor uuid,request uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE coverage jsonb; result jsonb; destination uuid;
BEGIN
 SELECT current_node_id INTO destination FROM g4a6.characters WHERE id=actor;
 coverage:=g4a9.cover(actor,destination);
 coverage:=jsonb_set(coverage,'{creatures}',coalesce((SELECT jsonb_agg(v ORDER BY v->>'id') FROM jsonb_array_elements(coverage->'creatures') v WHERE (v->>'node_id')::uuid=destination),'[]'));
 PERFORM set_config('app.combat2_depart_authorized','true',true);
 IF EXISTS(SELECT 1 FROM g4a6.node_pending_event WHERE request_id=request) THEN RETURN g4a6.combat2_arrive_after_relocation(actor,request); END IF;
 BEGIN
  PERFORM g4a9.account(coverage,true,true);result:=g4a6.combat2_arrive_after_relocation(actor,request);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'arrival refusal' USING ERRCODE='P1009'; END IF;
  PERFORM g4a9.account(coverage,false);
 EXCEPTION WHEN SQLSTATE 'P1009' THEN RETURN result;
 END;
 RETURN result;
END $$;
CREATE FUNCTION g4a9.regenerate(actor uuid,destination uuid,reverse_input boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE coverage jsonb:=g4a9.cover(actor,destination);
BEGIN PERFORM g4a9.account(coverage,true,false,reverse_input); END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a9 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;
