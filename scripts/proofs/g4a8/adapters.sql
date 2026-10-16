-- LOCAL / NON-DEPLOYABLE protocol adapters, not production replacements.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_%' OR to_regclass('g4a6.fixture_marker') IS NULL THEN RAISE EXCEPTION 'disposable fixture required'; END IF; END $$;
CREATE FUNCTION g4a8.cover(nodes uuid[]) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE n uuid; e uuid;
BEGIN
 FOR n IN SELECT DISTINCT unnest(nodes) ORDER BY 1 LOOP
  IF n IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0)); END IF;
 END LOOP;
 FOR e IN SELECT id FROM g4a6.node_encounter WHERE node_id=ANY(nodes) ORDER BY id FOR UPDATE LOOP NULL; END LOOP;
END $$;
CREATE FUNCTION g4a8.move(request uuid,party boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,g4a6,pg_temp AS $$
DECLARE origin uuid; destination uuid; cid uuid; result jsonb;
BEGIN
 IF party THEN SELECT origin_node_id,destination_node_id INTO STRICT origin,destination FROM g4a6.combat2_party_departure_request WHERE request_id=request;
 ELSE SELECT origin_node_id,destination_node_id INTO STRICT origin,destination FROM g4a6.combat2_departure_request WHERE request_id=request; END IF;
 PERFORM g4a8.cover(ARRAY[origin,destination]);
 IF EXISTS(SELECT 1 FROM g4a6.creatures c JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq
  JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.node_id=ANY(ARRAY[origin,destination]) AND e.node_id<>c.node_id)
 THEN RAISE EXCEPTION 'projection coverage mismatch' USING ERRCODE='40001'; END IF;
 -- Fixture requests are immutable. Refuse discovery drift; never add late gates.
 IF party THEN
  IF NOT EXISTS(SELECT 1 FROM g4a6.combat2_party_departure_request WHERE request_id=request AND origin_node_id=origin AND destination_node_id=destination) THEN RAISE EXCEPTION 'coverage changed' USING ERRCODE='40001'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM g4a6.combat2_departure_request WHERE request_id=request AND origin_node_id=origin AND destination_node_id=destination) THEN RAISE EXCEPTION 'coverage changed' USING ERRCODE='40001'; END IF;
 END IF;
 IF party AND EXISTS(SELECT 1 FROM g4a6.combat2_party_departure_request WHERE request_id=request AND status='completed') THEN RETURN g4a6.combat2_finish_immediate_party_departure(request); END IF;
 IF NOT party AND EXISTS(SELECT 1 FROM g4a6.combat2_departure_request WHERE request_id=request AND status IN('moved','dead')) THEN RETURN g4a6.combat2_finish_immediate_departure(request); END IF;
 -- Settle destination BEFORE relocation takes any character row lock.
 FOR cid IN SELECT id FROM g4a6.creatures WHERE node_id=destination ORDER BY id LOOP
  PERFORM g4a6.lock_creature(cid);
  UPDATE g4a6.node_encounter SET claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL WHERE node_id=destination;
  PERFORM g4a6.settle(cid,g4a6.test_now());
 END LOOP;
 IF party THEN result:=g4a6.combat2_finish_immediate_party_departure(request);
 ELSE result:=g4a6.combat2_finish_immediate_departure(request); END IF;
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'movement refused: %',result->>'kind'; END IF;
 -- Player departure alone is insufficient: reconcile checks pending work/effects.
 FOR cid IN SELECT id FROM g4a6.creatures WHERE node_id=ANY(ARRAY[origin,destination]) ORDER BY id LOOP
  PERFORM g4a6.reconcile(cid,g4a6.test_now());
 END LOOP;
 RETURN result;
END $$;
CREATE TRIGGER g4a8_arrival AFTER UPDATE OF current_node_id ON g4a6.characters
 FOR EACH ROW EXECUTE FUNCTION g4a6.combat2_authoritative_arrival_trigger();
CREATE TRIGGER trg_characters_node_change_participation AFTER UPDATE OF current_node_id ON g4a6.characters
 FOR EACH ROW WHEN (OLD.current_node_id IS DISTINCT FROM NEW.current_node_id AND OLD.current_node_id IS NOT NULL)
 EXECUTE FUNCTION g4a6.characters_end_participation_on_node_change();

CREATE FUNCTION g4a8.arrive(actor uuid,request uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n uuid; cid uuid; result jsonb;
BEGIN
 SELECT current_node_id INTO STRICT n FROM g4a6.characters WHERE id=actor;
 PERFORM g4a8.cover(ARRAY[n]);
 IF NOT EXISTS(SELECT 1 FROM g4a6.characters WHERE id=actor AND current_node_id=n) THEN RAISE EXCEPTION 'arrival coverage changed' USING ERRCODE='40001'; END IF;
 PERFORM set_config('app.combat2_depart_authorized','true',true);
 IF EXISTS(SELECT 1 FROM g4a6.node_pending_event WHERE request_id=request) THEN RETURN g4a6.combat2_arrive_after_relocation(actor,request); END IF;
 IF EXISTS(SELECT 1 FROM g4a6.creatures c JOIN g4a6.node_creature nc ON nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq
  JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.node_id=n AND e.node_id<>n)
 THEN RAISE EXCEPTION 'projection coverage mismatch' USING ERRCODE='40001'; END IF;
 FOR cid IN SELECT id FROM g4a6.creatures WHERE node_id=n ORDER BY id LOOP
  PERFORM g4a6.lock_creature(cid);
  UPDATE g4a6.node_encounter SET claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL WHERE node_id=n;
  PERFORM g4a6.settle(cid,g4a6.test_now());
 END LOOP;
 PERFORM set_config('app.combat2_depart_authorized','true',true);
 result:=g4a6.combat2_arrive_after_relocation(actor,request);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'arrival refused: %',result->>'kind'; END IF;
 FOR cid IN SELECT id FROM g4a6.creatures WHERE node_id=n ORDER BY id LOOP PERFORM g4a6.reconcile(cid,g4a6.test_now()); END LOOP;
 RETURN result;
END $$;

-- Raw production Admin payloads are NOT replayed as safe APIs. A conservative
-- local guard refuses protected direct writes, avoiding late node acquisition
-- inside a row trigger. Dedicated candidate operations below remain private.
CREATE FUNCTION g4a8.raw_admin_save(cid uuid,payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF payload ?| ARRAY['hp','max_hp','regen_bps','node_id','is_alive','spawn_seq'] THEN RAISE EXCEPTION 'dedicated guarded writer required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k<>'name') THEN RAISE EXCEPTION 'unsupported fixture edit'; END IF;
 UPDATE g4a6.creatures SET name=payload->>'name' WHERE id=cid;
END $$;
CREATE FUNCTION g4a8.guarded_edit(cid uuid,kind text,value text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF kind='rate' THEN
  PERFORM g4a7.edit_rate(cid,value);
  UPDATE g4a6.node_encounter SET state_version=state_version+1,claim_token=NULL,claimed_tick=NULL,claim_expires_at=NULL
  WHERE id IN(SELECT nc.encounter_id FROM g4a6.node_creature nc JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq WHERE c.id=cid);
 ELSIF kind='max' THEN PERFORM g4a7.edit_max(cid,value::integer);
 ELSIF kind='node' THEN PERFORM g4a6.reassign(cid,value::uuid,g4a6.test_now());
 ELSIF kind='delete' THEN
  PERFORM g4a6.lock_creature(cid);
  IF EXISTS(SELECT 1 FROM g4a6.node_creature WHERE creature_id=cid) THEN RAISE EXCEPTION 'retained projection: deletion deferred'; END IF;
  DELETE FROM g4a6.creatures WHERE id=cid;
 ELSE RAISE EXCEPTION 'unsupported edit'; END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a8 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a6 FROM PUBLIC;
