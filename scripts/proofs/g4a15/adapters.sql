-- Private future-contract adapters. NOT production RPCs or installed protection.
DO $$ BEGIN IF current_database() NOT LIKE 'g4a6_fixture_g4a12_g4a13_g4a14_g4a15_%' THEN RAISE EXCEPTION 'fixture only'; END IF; END $$;
CREATE FUNCTION g4a15.discover(cid uuid,destination uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $$
 WITH c AS(SELECT id,node_id,spawn_seq FROM g4a6.creatures WHERE id=cid),
 refs AS(SELECT nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq FROM g4a6.node_creature nc WHERE nc.creature_id=cid),
 nodes AS(SELECT node_id id FROM c UNION SELECT destination UNION SELECT e.node_id FROM g4a6.node_encounter e WHERE e.id IN(SELECT encounter_id FROM refs)),
 enc AS(SELECT id,node_id FROM g4a6.node_encounter WHERE node_id IN(SELECT id FROM nodes))
 SELECT jsonb_build_object('creature',(SELECT to_jsonb(c) FROM c),'nodes',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM nodes WHERE id IS NOT NULL),'[]'),
 'encounters',coalesce((SELECT jsonb_agg(to_jsonb(enc) ORDER BY id) FROM enc),'[]'),
 'projections',coalesce((SELECT jsonb_agg(to_jsonb(refs) ORDER BY id) FROM refs),'[]'))
$$;
CREATE FUNCTION g4a15.cover(cid uuid,destination uuid DEFAULT NULL,allow_missing boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before jsonb:=g4a15.discover(cid,destination); n uuid;
BEGIN
 IF before->'creature'='null'::jsonb AND NOT allow_missing THEN RAISE EXCEPTION 'creature missing'; END IF;
 FOR n IN SELECT value::uuid FROM jsonb_array_elements_text(before->'nodes') ORDER BY value::uuid LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 IF before IS DISTINCT FROM g4a15.discover(cid,destination) THEN RAISE EXCEPTION 'Admin coverage changed; rediscover' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM g4a6.node_encounter WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(before->'encounters') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM g4a6.node_creature WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(before->'projections') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM g4a6.creatures WHERE id=cid FOR UPDATE;
 IF before IS DISTINCT FROM g4a15.discover(cid,destination) THEN RAISE EXCEPTION 'Admin coverage changed under dependent locks' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM g4a6.node_creature nc JOIN g4a6.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq JOIN g4a6.node_encounter e ON e.id=nc.encounter_id WHERE c.id=cid AND c.node_id IS DISTINCT FROM e.node_id)
 THEN RAISE EXCEPTION 'projection ownership mismatch'; END IF;
END $$;
CREATE FUNCTION g4a15.authorize() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF g4a9.actor_uid() IS NULL OR NOT g4a6.is_steward_or_overlord() THEN RAISE EXCEPTION 'Admin not authorized' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION g4a15.edit(cid uuid,kind text,payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE dest uuid;
BEGIN
 PERFORM g4a15.authorize();
 IF kind='node' THEN dest:=NULLIF(payload->>'value','')::uuid; IF dest IS NOT NULL AND NOT EXISTS(SELECT 1 FROM g4a6.nodes WHERE id=dest) THEN RAISE EXCEPTION 'destination missing'; END IF; END IF;
 PERFORM g4a15.cover(cid,dest);
 IF kind='metadata' THEN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload='{}' OR EXISTS(SELECT 1 FROM jsonb_each(payload) WHERE key NOT IN('name','description') OR jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION 'dedicated guarded configuration writer required'; END IF;
  IF payload ? 'name' AND btrim(payload->>'name')='' THEN RAISE EXCEPTION 'name required'; END IF;
  UPDATE g4a6.creatures SET name=coalesce(payload->>'name',name),description=coalesce(payload->>'description',description) WHERE id=cid;
 ELSIF kind IN('max','rate') THEN PERFORM g4a8.guarded_edit(cid,kind,payload->>'value');
 ELSIF kind='node' THEN
  IF dest IS NOT NULL THEN
   -- The inherited helper checks this creature's blockers. Also require the
   -- destination to be genuinely quiet, not just labelled ended.
   IF EXISTS(SELECT 1 FROM g4a6.node_encounter e WHERE e.node_id=dest AND (
     e.status<>'ended' OR e.claim_token IS NOT NULL
     OR EXISTS(SELECT 1 FROM g4a6.node_creature nc WHERE nc.encounter_id=e.id AND nc.pending_action IS NOT NULL)
     OR EXISTS(SELECT 1 FROM g4a6.node_effect x WHERE x.encounter_id=e.id)
     OR EXISTS(SELECT 1 FROM g4a6.node_intent i WHERE i.encounter_id=e.id AND i.status='pending')
     OR EXISTS(SELECT 1 FROM g4a6.node_pending_event p WHERE p.encounter_id=e.id AND p.consumed_at IS NULL)))
   THEN RAISE EXCEPTION 'destination not quiescent'; END IF;
   PERFORM g4a6.reassign(cid,dest,g4a6.test_now());
  ELSE
   IF EXISTS(SELECT 1 FROM g4a6.node_creature WHERE creature_id=cid) OR g4a6.blocked(cid) THEN RAISE EXCEPTION 'retained projection: unassignment deferred'; END IF;
   PERFORM g4a6.settle(cid,g4a6.test_now()); UPDATE g4a6.creatures SET node_id=NULL WHERE id=cid;
  END IF;
 ELSIF kind='delete' THEN
  IF EXISTS(SELECT 1 FROM g4a6.node_creature WHERE creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_effect WHERE source_creature_id=cid OR target_creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_participation WHERE creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_reward_claim WHERE creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_death_loot WHERE creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_intent WHERE target_creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_pending_event WHERE actor_creature_id=cid OR target_creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.node_boss_ability_cooldown WHERE creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.encounter_creatures WHERE creature_id=cid)
   OR EXISTS(SELECT 1 FROM g4a6.combat_sessions WHERE cid=ANY(engaged_creature_ids))
  THEN RAISE EXCEPTION 'retained references: deletion deferred'; END IF;
  DELETE FROM g4a6.creatures WHERE id=cid;
 ELSE RAISE EXCEPTION 'unsupported Admin edit'; END IF;
END $$;
-- Literal transport for the actual source INSERT/UPDATE payload. Only private
-- owner fixtures can call it; no production raw-DML containment is claimed.
CREATE FUNCTION g4a15.source_write(cid uuid,payload jsonb,creating boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cols text; vals text;
BEGIN
 PERFORM g4a15.authorize();
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN('id','name','description','node_id','level','rarity','hp','max_hp','ac','stats','is_aggressive','base_aggressive','is_humanoid','respawn_seconds','boss_crit_flavors','boss_death_cry','boss_cast','loot_table','loot_table_id','loot_mode','drop_chance')) THEN RAISE EXCEPTION 'unsupported source payload'; END IF;
 SELECT string_agg(format('%I',k),',' ORDER BY k),string_agg(format('(jsonb_populate_record(NULL::g4a6.creatures,$1)).%I',k),',' ORDER BY k) INTO cols,vals FROM jsonb_object_keys(payload) k;
 IF creating THEN EXECUTE format('INSERT INTO g4a6.creatures(%s) SELECT %s',cols,vals) USING payload;
 ELSE EXECUTE format('UPDATE g4a6.creatures SET (%s)=(SELECT %s) WHERE id=$2',cols,vals) USING payload,cid; END IF;
END $$;
CREATE FUNCTION g4a15.create_from_source(payload jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cid uuid:=(payload->>'id')::uuid; dest uuid:=(payload->>'node_id')::uuid;
BEGIN
 PERFORM g4a15.authorize();
 IF cid IS NULL OR EXISTS(SELECT 1 FROM g4a6.creatures WHERE id=cid) OR coalesce(btrim(payload->>'name'),'')='' OR (payload->>'hp') IS NULL OR (payload->>'max_hp') IS NULL OR (payload->>'hp')::integer IS DISTINCT FROM (payload->>'max_hp')::integer OR (payload->>'max_hp')::integer<1 THEN RAISE EXCEPTION 'invalid new creature'; END IF;
 PERFORM g4a15.cover(cid,dest,true);
 IF dest IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM g4a6.nodes WHERE id=dest) OR EXISTS(SELECT 1 FROM g4a6.node_encounter WHERE node_id=dest AND (status='active' OR claim_token IS NOT NULL))) THEN RAISE EXCEPTION 'creation node not quiet'; END IF;
 PERFORM g4a15.source_write(cid,payload,true);
 PERFORM g4a6.settle(cid,g4a6.test_now());
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA g4a15 FROM PUBLIC;
