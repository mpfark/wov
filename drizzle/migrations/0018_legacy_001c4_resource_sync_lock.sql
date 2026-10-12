-- ENG-LEGACY-001C4: reviewed forward correction; NOT INSTALLED.
-- Keep outside automatic migrations; standard Lovable Drizzle only after authorization.
BEGIN;
DO $patch$
DECLARE
 target oid:='public.sync_character_resources(uuid)'::regprocedure;
 original text; patched text; definition text;
 owner_before oid; config_before text[]; acl_before aclitem[]; execute_before boolean[];
BEGIN
 SELECT replace(prosrc,E'\r\n',E'\n'),proowner,proconfig,proacl
 INTO original,owner_before,config_before,acl_before FROM pg_proc WHERE oid=target;
 IF encode(sha256(convert_to(original,'UTF8')),'hex')<>'f5fb2896e66dec364d86403494c485b0e9ef967e7fe1bb99a1fae7bf8a30e096'
 OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=target
   AND p.proowner='postgres'::regrole AND p.prosecdef AND p.provolatile='v' AND NOT p.proretset
   AND p.prorettype='jsonb'::regtype AND p.proconfig=ARRAY['search_path=public']::text[]
   AND l.lanname='plpgsql' AND p.proargnames=ARRAY['p_character_id']::text[] AND p.pronargdefaults=0)
 THEN RAISE EXCEPTION 'C4 sync source/security drift'; END IF;
 execute_before:=ARRAY[has_function_privilege('anon',target,'EXECUTE'),
   has_function_privilege('authenticated',target,'EXECUTE'),has_function_privilege('service_role',target,'EXECUTE')];
 patched:=replace(original,'SELECT * INTO c FROM public.characters WHERE id=p_character_id;',
   'SELECT * INTO c FROM public.characters WHERE id=p_character_id FOR UPDATE;');
 IF patched=original THEN RAISE EXCEPTION 'C4 sync anchor drift'; END IF;
 definition:=pg_get_functiondef(target);
 definition:=replace(definition,(SELECT prosrc FROM pg_proc WHERE oid=target),patched);
 EXECUTE definition;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND
   (proowner IS DISTINCT FROM owner_before OR NOT prosecdef OR proconfig IS DISTINCT FROM config_before
    OR proacl IS DISTINCT FROM acl_before OR prosrc IS DISTINCT FROM patched))
 OR ARRAY[has_function_privilege('anon',target,'EXECUTE'),has_function_privilege('authenticated',target,'EXECUTE'),
   has_function_privilege('service_role',target,'EXECUTE')] IS DISTINCT FROM execute_before
 THEN RAISE EXCEPTION 'C4 sync metadata/authority changed'; END IF;
END $patch$;
COMMIT;
