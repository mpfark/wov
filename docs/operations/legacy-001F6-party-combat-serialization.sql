-- ENG-LEGACY-001F6: reviewed candidate only; not automatically routed or installed.
-- One atomic function replacement. No grants, helpers, tables or gameplay changes.
BEGIN;
DO $migration$
DECLARE
 fn oid:=to_regprocedure('public.party_mutate(uuid,text,uuid,uuid,uuid,uuid)');
 definition text; before_owner oid; before_security boolean; before_volatility "char";
 before_config text[]; before_acl aclitem[]; before_rights jsonb;
 declaration_needle text:=' member public.party_members; created_party uuid; result jsonb; member_count integer;';
 boundary_needle text:=' -- Global order: lifecycle advisory lock, request row, actor row, party row, membership rows.';
 replacement text:=$f6$ -- ENG-LEGACY-001F6: committed replay remains independent of current combat state.
 SELECT * INTO prior FROM public.party_operation_request WHERE request_id=_request_id;
 IF FOUND THEN
  IF prior.caller_id IS DISTINCT FROM caller OR prior.actor_character_id<>_actor_character_id OR prior.operation<>_operation
   OR prior.party_id IS DISTINCT FROM _party_id OR prior.target_character_id IS DISTINCT FROM _target_character_id
   OR prior.membership_id IS DISTINCT FROM _membership_id THEN RETURN jsonb_build_object('ok',false,'kind','request_id_conflict'); END IF;
  RETURN COALESCE(prior.result,jsonb_build_object('ok',false,'kind','request_in_progress'));
 END IF;

 IF _operation IN ('accept','leave','kick','disband','follow','stop_following','set_tank') THEN
  FOR lock_stage IN 0..2 LOOP
   -- Unlocked discovery is repeated after waiting. Never expand lock coverage late.
   WITH chosen_party AS (
    SELECT CASE WHEN _operation='accept' THEN
     (SELECT pm.party_id FROM public.party_members pm WHERE pm.id=_membership_id AND pm.character_id=_actor_character_id)
     ELSE _party_id END AS id
   ), members AS (
    SELECT pm.id,pm.party_id,pm.character_id,pm.status,pm.is_following
    FROM public.party_members pm JOIN chosen_party chosen ON chosen.id=pm.party_id
   ), affected AS (
    SELECT _actor_character_id AS id UNION SELECT character_id FROM members
   ), chars AS (
    SELECT c.id,c.current_node_id,c.deleted_at FROM public.characters c JOIN affected a ON a.id=c.id
   ), referenced_encounters AS (
    SELECT nf.encounter_id AS id FROM public.node_fighter nf JOIN affected a ON a.id=nf.character_id
    UNION SELECT g.encounter_id FROM public.node_arrival_group g JOIN chosen_party chosen ON chosen.id=g.party_id WHERE g.active
    UNION SELECT d.encounter_id FROM public.combat2_departure_request d JOIN affected a ON a.id=d.character_id
     WHERE d.status IN ('pending','queued')
   ), encounters AS (
    SELECT e.id,e.node_id FROM public.node_encounter e
    WHERE e.node_id IN (SELECT current_node_id FROM chars) OR e.id IN (SELECT id FROM referenced_encounters)
   ), nodes AS (
    SELECT current_node_id AS id FROM chars WHERE current_node_id IS NOT NULL
    UNION SELECT node_id FROM encounters WHERE node_id IS NOT NULL
   )
   SELECT jsonb_build_object(
    'party',(SELECT id FROM chosen_party),
    'members',COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM members m),'[]'::jsonb),
    'characters',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM chars c),'[]'::jsonb),
    'encounters',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM encounters e),'[]'::jsonb),
    'nodes',COALESCE((SELECT jsonb_agg(n.id ORDER BY n.id) FROM nodes n),'[]'::jsonb)
   ) INTO lock_coverage;
   IF lock_stage=0 THEN
    original_coverage:=lock_coverage;
    FOR locked_id IN SELECT value::uuid FROM jsonb_array_elements_text(lock_coverage->'nodes') ORDER BY value::uuid LOOP
     PERFORM pg_advisory_xact_lock(hashtextextended('combat_enter_node:'||locked_id::text,0));
    END LOOP;
    PERFORM pg_advisory_xact_lock(hashtextextended('party-lifecycle',0));
   ELSE
    IF lock_coverage IS DISTINCT FROM original_coverage THEN
     RETURN jsonb_build_object('ok',false,'kind','party_operation_failed','reason','lock_coverage_changed');
    END IF;
    IF lock_stage=1 THEN
     PERFORM 1 FROM public.node_encounter e
      WHERE e.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(lock_coverage->'encounters'))
      ORDER BY e.id FOR UPDATE;
     PERFORM 1 FROM public.characters c
      WHERE c.id IN (SELECT (value->>'id')::uuid FROM jsonb_array_elements(lock_coverage->'characters'))
      ORDER BY c.id FOR UPDATE;
    END IF;
   END IF;
  END LOOP;
 END IF;
$f6$;
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'F6 party_mutate missing'; END IF;
 SELECT pg_get_functiondef(p.oid),p.proowner,p.prosecdef,p.provolatile,p.proconfig,p.proacl
 INTO definition,before_owner,before_security,before_volatility,before_config,before_acl FROM pg_proc p WHERE p.oid=fn;
 IF (pg_get_userbyid(before_owner)='postgres' AND before_security AND before_volatility='v'
  AND before_config=ARRAY['search_path=public, auth, pg_temp']::text[]
  AND encode(sha256(convert_to(regexp_replace(replace(definition,E'\r\n',E'\n'),'[[:space:]]+',' ','g'),'UTF8')),'hex')
   ='f00dc054af96c05d74b66be30db9909c6b6baafdf33e57b98a04a967aae0745f') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'F6 installed party_mutate source/settings drift';
 END IF;
 IF has_function_privilege('anon',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
  OR NOT has_function_privilege('service_role',fn,'EXECUTE') OR NOT has_function_privilege('postgres',fn,'EXECUTE') THEN
  RAISE EXCEPTION 'F6 party_mutate authority drift';
 END IF;
 SELECT jsonb_object_agg(r.rolname,has_function_privilege(r.oid,fn,'EXECUTE')) INTO before_rights
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','postgres');
 IF position(declaration_needle IN definition)=0 OR position(boundary_needle IN definition)=0 THEN
  RAISE EXCEPTION 'F6 source insertion boundary missing';
 END IF;
 definition:=replace(definition,declaration_needle,declaration_needle||chr(10)||
  ' lock_stage integer; locked_id uuid; lock_coverage jsonb; original_coverage jsonb;');
 definition:=replace(definition,boundary_needle,replacement||' -- Existing request/actor/party/member authorization and mutation body unchanged.');
 EXECUTE definition;
 IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=fn AND
  (p.proowner IS DISTINCT FROM before_owner OR p.prosecdef IS DISTINCT FROM before_security
   OR p.provolatile IS DISTINCT FROM before_volatility OR p.proconfig IS DISTINCT FROM before_config
   OR p.proacl IS DISTINCT FROM before_acl)) OR
  (SELECT jsonb_object_agg(r.rolname,has_function_privilege(r.oid,fn,'EXECUTE')) FROM pg_roles r
   WHERE r.rolname IN ('anon','authenticated','service_role','postgres')) IS DISTINCT FROM before_rights THEN
  RAISE EXCEPTION 'F6 function identity/authority preservation failed';
 END IF;
END;
$migration$;
COMMIT;
