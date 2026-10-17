-- Source fragment assembled into the consolidated forward candidate. Not installed.
CREATE FUNCTION public.creature_hp_discover(input_nodes uuid[], input_actors uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 WITH actors AS(SELECT unnest(input_actors) id UNION SELECT f.character_id FROM public.node_fighter f
 JOIN public.node_encounter e ON e.id=f.encounter_id WHERE e.node_id=ANY(input_nodes)),
 parties AS(SELECT p.id,p.leader_id,p.tank_id FROM public.parties p WHERE p.leader_id IN(SELECT id FROM actors)
 OR EXISTS(SELECT 1 FROM public.party_members m WHERE m.party_id=p.id AND m.character_id IN(SELECT id FROM actors))),
 members AS(SELECT m.id,m.party_id,m.character_id,m.status,m.is_following FROM public.party_members m WHERE m.party_id IN(SELECT id FROM parties)),
 chars AS(SELECT c.id,c.current_node_id,c.deleted_at FROM public.characters c WHERE c.id IN(SELECT id FROM actors UNION SELECT character_id FROM members)),
 base AS(SELECT unnest(input_nodes) id UNION SELECT current_node_id FROM chars),
 creatures AS(SELECT c.id,c.node_id,c.spawn_seq FROM public.creatures c WHERE c.node_id IN(SELECT id FROM base)
 OR EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.node_encounter e ON e.id=nc.encounter_id
 WHERE nc.creature_id=c.id AND nc.spawn_seq=c.spawn_seq AND e.node_id IN(SELECT id FROM base))),
 refs AS(SELECT f.encounter_id id FROM public.node_fighter f WHERE f.character_id IN(SELECT id FROM chars)
 UNION SELECT nc.encounter_id FROM public.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
 UNION SELECT g.encounter_id FROM public.node_arrival_group g WHERE g.active AND g.party_id IN(SELECT id FROM parties)),
 encounters AS(SELECT e.id,e.node_id FROM public.node_encounter e WHERE e.node_id IN(SELECT id FROM base) OR e.id IN(SELECT id FROM refs)),
 nodes AS(SELECT id FROM base UNION SELECT node_id FROM encounters UNION SELECT node_id FROM creatures)
 SELECT jsonb_build_object('nodes',coalesce((SELECT jsonb_agg(id ORDER BY id) FROM nodes WHERE id IS NOT NULL),'[]'),
 'parties',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM parties p),'[]'),
 'members',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM members m),'[]'),
 'characters',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM chars c),'[]'),
 'encounters',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM encounters e),'[]'),
 'creatures',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM creatures c),'[]'),
 'projections',coalesce((SELECT jsonb_agg(jsonb_build_array(nc.id,nc.encounter_id,nc.creature_id,nc.spawn_seq) ORDER BY nc.id)
 FROM public.node_creature nc JOIN creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq),'[]'))
$$;

CREATE FUNCTION public.creature_hp_cover(input_nodes uuid[],input_actors uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE coverage jsonb:=public.creature_hp_discover(input_nodes,input_actors); inherited jsonb; n uuid;
BEGIN
 inherited:=nullif(current_setting('app.creature_hp_coverage',true),'')::jsonb;
 IF inherited IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coverage->'nodes') v
 WHERE NOT(inherited->'nodes' ? v)) THEN RAISE EXCEPTION 'late creature HP node coverage' USING ERRCODE='40001'; END IF;
 FOR n IN SELECT value::uuid FROM jsonb_array_elements_text(coverage->'nodes') ORDER BY value::uuid LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||n::text,0));
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
 IF coverage IS DISTINCT FROM public.creature_hp_discover(input_nodes,input_actors) THEN RAISE EXCEPTION 'HP coverage changed before rows' USING ERRCODE='40001'; END IF;
 PERFORM 1 FROM public.node_encounter WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'encounters') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.node_creature WHERE id IN(SELECT (v->>0)::uuid FROM jsonb_array_elements(coverage->'projections') v) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.creatures WHERE id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v) ORDER BY id FOR UPDATE;
 IF coverage IS DISTINCT FROM public.creature_hp_discover(input_nodes,input_actors) THEN RAISE EXCEPTION 'HP coverage changed under rows' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.node_creature nc JOIN public.creatures c ON c.id=nc.creature_id AND c.spawn_seq=nc.spawn_seq
 JOIN public.node_encounter e ON e.id=nc.encounter_id WHERE c.id IN(SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v)
 AND c.node_id IS DISTINCT FROM e.node_id) THEN RAISE EXCEPTION 'foreign HP projection' USING ERRCODE='40001'; END IF;
 RETURN coverage;
END $$;

CREATE FUNCTION public.creature_hp_account(coverage jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE cid uuid;
BEGIN
 FOR cid IN SELECT (v->>'id')::uuid FROM jsonb_array_elements(coverage->'creatures') v ORDER BY (v->>'id')::uuid LOOP
   PERFORM public.creature_regen_settle(cid,now());
 END LOOP;
END $$;
ALTER FUNCTION public.creature_hp_discover(uuid[],uuid[]) OWNER TO postgres;
ALTER FUNCTION public.creature_hp_cover(uuid[],uuid[]) OWNER TO postgres;
ALTER FUNCTION public.creature_hp_account(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.creature_hp_discover(uuid[],uuid[]),public.creature_hp_cover(uuid[],uuid[]),public.creature_hp_account(jsonb) FROM PUBLIC,anon,authenticated,service_role;
