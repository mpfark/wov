-- ENG-LEGACY-001B3: forward-only reviewed input; NOT installed.
-- Standard Lovable/Drizzle registration only after separate authorization.
-- Exact normalized prosrc guard: CRLF -> LF only. No grants or predecessors changed.
BEGIN;
DO $patch$
DECLARE
 target oid := 'public.node_tick_commit(uuid,uuid,integer,integer,bigint,uuid[],jsonb)'::regprocedure;
 original text; patched text; definition text; acl_before aclitem[];
BEGIN
 SELECT replace(prosrc,E'\r\n',E'\n'),proacl INTO original,acl_before FROM pg_proc WHERE oid=target;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'5b3e9af0eebd5c0cecff33f40d14c4aa9743e0ecec57a9035f712d0177aec21c'
   OR (SELECT proowner<>'postgres'::regrole OR NOT prosecdef OR provolatile<>'v'
       OR proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
       OR prorettype<>'jsonb'::regtype FROM pg_proc WHERE oid=target)
 THEN RAISE EXCEPTION 'B3 outer stance commit source/security drift'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_proc
   WHERE oid=to_regprocedure('public.node_tick_commit_without_character_stances(uuid,uuid,integer,integer,bigint,uuid[],jsonb)')
   AND encode(sha256(convert_to(replace(prosrc,E'\r\n',E'\n'),'UTF8')),'hex')='f85c74a47f56a2a3c84b40cc420e941c59de7096656a8d32dcfb1270e80d5bb0'
   AND proowner='postgres'::regrole AND prosecdef AND provolatile='v'
   AND proconfig=ARRAY['search_path=public, pg_temp']::text[] AND prorettype='jsonb'::regtype)
 THEN RAISE EXCEPTION 'B3A direct predecessor lock contract drift'; END IF;
 IF NOT has_function_privilege('service_role',target,'EXECUTE')
    OR has_function_privilege('anon',target,'EXECUTE')
    OR has_function_privilege('authenticated',target,'EXECUTE')
 THEN RAISE EXCEPTION 'B3 outer stance commit ACL drift'; END IF;
 patched:=replace(original,'DECLARE row jsonb; result jsonb; current_version bigint;',
   'DECLARE row jsonb; result jsonb; current_version bigint; stance_target uuid; locked_node uuid; encounter_node uuid;');
 patched:=replace(patched,E'BEGIN\n FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->''stance_fence''',
   $guard$BEGIN
 -- Match the direct predecessor: ordered origin/moved-destination node locks
 -- must precede encounter, fighter and stance row locks. Reacquisition by the
 -- predecessor is transaction-reentrant; it cannot add a new node after this.
 SELECT node_id INTO encounter_node FROM public.node_encounter WHERE id=_encounter_id;
 FOR locked_node IN
   SELECT node_id FROM (
     SELECT encounter_node AS node_id
     UNION
     SELECT (departure->>'destination_node_id')::uuid
     FROM jsonb_array_elements(coalesce(_proposed->'departures','[]'::jsonb)) departure
     WHERE departure->>'outcome'='moved'
   ) nodes WHERE node_id IS NOT NULL ORDER BY node_id
 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_node::text,0));
 END LOOP;
 PERFORM 1 FROM public.node_encounter WHERE id=_encounter_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.node_encounter WHERE id=_encounter_id
   AND node_id IS DISTINCT FROM encounter_node)
 THEN RAISE EXCEPTION 'stance_encounter_node_changed'; END IF;
 -- Membership is historical within this encounter, not post-resolution presence.
 -- UNION also avoids repeated locks for targets present in several stance arrays.
 FOR stance_target IN
   SELECT (value->>'character_id')::uuid FROM jsonb_array_elements(coalesce(_proposed->'stance_fence','[]'::jsonb))
   UNION SELECT (value->>'character_id')::uuid FROM jsonb_array_elements(coalesce(_proposed->'stance_updates','[]'::jsonb))
   UNION SELECT value::uuid FROM jsonb_array_elements_text(coalesce(_proposed->'stance_clear_character_ids','[]'::jsonb))
   ORDER BY 1
 LOOP
   IF stance_target IS NULL THEN RAISE EXCEPTION 'stance_target_invalid'; END IF;
   PERFORM 1 FROM public.node_fighter
     WHERE encounter_id=_encounter_id AND character_id=stance_target
     ORDER BY id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'stance_target_outside_encounter'; END IF;
 END LOOP;
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(_proposed->'stance_fence'$guard$);
 IF patched=original OR position('stance_target_outside_encounter' in patched)=0
 THEN RAISE EXCEPTION 'B3 patch anchor drift'; END IF;
 definition:=pg_get_functiondef(target);
 -- The renderer embeds raw prosrc, which may retain CRLF even after comparison normalization.
 definition:=replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=target),patched);
 EXECUTE definition;
 IF (SELECT proacl IS DISTINCT FROM acl_before FROM pg_proc WHERE oid=target)
 THEN RAISE EXCEPTION 'B3 ACL changed'; END IF;
END $patch$;
COMMIT;
