-- ENG-STANCE-001: ACL-only follow-up. Installed stance SQL/data remain unchanged.
DO $$
DECLARE spec record; fn oid; role_name text; signature text;
BEGIN
  -- Exact signatures and metadata from the committed predecessor composition.
  FOR spec IN SELECT * FROM (VALUES
    ('public.drop_stance(uuid,text)','public'),
    ('public.activate_stance(uuid,text,integer)','public'),
    ('public.apply_force_shield_regen(uuid)','public'),
    ('public.combat2_test_stop_without_character_stances(uuid,uuid)','public, auth, pg_temp'),
    ('public.combat2_test_reset_without_character_stances(uuid,uuid,boolean)','public, auth, pg_temp'),
    ('public.combat2_change_stance(uuid,text,text,uuid)','public, pg_temp'),
    ('public.combat2_character_stances(uuid)','public, pg_temp'),
    ('public.combat2_test_stop(uuid,uuid)','public, pg_temp'),
    ('public.combat2_test_reset(uuid,uuid,boolean)','public, pg_temp')
  ) AS expected(signature,path) LOOP
    fn:=to_regprocedure(spec.signature);
    IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
      AND p.proowner='postgres'::regrole AND p.prosecdef AND p.prokind='f'
      AND p.provolatile=(CASE WHEN spec.signature='public.combat2_character_stances(uuid)' THEN 's' ELSE 'v' END)::"char"
      AND p.prorettype='jsonb'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path='||spec.path]) THEN
      RAISE EXCEPTION 'ENG-STANCE ACL predecessor metadata drift: %',spec.signature;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('drop_stance','activate_stance','apply_force_shield_regen',
        'combat2_test_stop_without_character_stances','combat2_test_reset_without_character_stances'))<>5 THEN
    RAISE EXCEPTION 'ENG-STANCE ACL unexpected legacy/helper overload';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.combat2_test_stop(uuid,uuid)'::regprocedure
      AND prosrc LIKE '%public.combat2_test_stop_without_character_stances(_arena_id,_request_id)%'
      AND prosrc LIKE '%public.combat2_restore_arena_stances(_arena_id)%')
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.combat2_test_reset(uuid,uuid,boolean)'::regprocedure
      AND prosrc LIKE '%public.combat2_test_reset_without_character_stances(_arena_id,_request_id,_confirm_destroy_diagnostics)%'
      AND prosrc LIKE '%public.combat2_restore_arena_stances(_arena_id)%') THEN
    RAISE EXCEPTION 'ENG-STANCE ACL canonical Arena wrapper composition drift';
  END IF;
  -- Previously hardened siblings must remain denied; do not silently accept drift.
  FOREACH signature IN ARRAY ARRAY['public.activate_stance(uuid,text,integer)','public.apply_force_shield_regen(uuid)'] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,to_regprocedure(signature),'EXECUTE') THEN
        RAISE EXCEPTION 'ENG-STANCE ACL sibling browser privilege drift: % / %',signature,role_name;
      END IF;
    END LOOP;
  END LOOP;
  CREATE TEMP TABLE eng_stance_acl_before ON COMMIT DROP AS
    SELECT p.oid,p.prosrc,p.proowner,p.prosecdef,p.provolatile,p.proconfig FROM pg_proc p
    WHERE p.oid IN('public.drop_stance(uuid,text)'::regprocedure,
      'public.combat2_test_stop_without_character_stances(uuid,uuid)'::regprocedure,
      'public.combat2_test_reset_without_character_stances(uuid,uuid,boolean)'::regprocedure);
  REVOKE EXECUTE ON FUNCTION public.drop_stance(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE EXECUTE ON FUNCTION public.combat2_test_stop_without_character_stances(uuid,uuid) FROM PUBLIC,anon,authenticated;
  REVOKE EXECUTE ON FUNCTION public.combat2_test_reset_without_character_stances(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.drop_stance(uuid,text) TO service_role;
  GRANT EXECUTE ON FUNCTION public.combat2_test_stop_without_character_stances(uuid,uuid) TO service_role;
  GRANT EXECUTE ON FUNCTION public.combat2_test_reset_without_character_stances(uuid,uuid,boolean) TO service_role;
  FOR fn IN SELECT oid FROM pg_temp.eng_stance_acl_before LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'ENG-STANCE ACL browser denial failed'; END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role',fn,'EXECUTE') OR NOT has_function_privilege('postgres',fn,'EXECUTE') THEN
      RAISE EXCEPTION 'ENG-STANCE ACL required server access missing';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_temp.eng_stance_acl_before b JOIN pg_proc p ON p.oid=b.oid
    WHERE ROW(p.prosrc,p.proowner,p.prosecdef,p.provolatile,p.proconfig)
      IS DISTINCT FROM ROW(b.prosrc,b.proowner,b.prosecdef,b.provolatile,b.proconfig)) THEN
    RAISE EXCEPTION 'ENG-STANCE ACL changed function body/metadata';
  END IF;
  FOREACH signature IN ARRAY ARRAY['public.combat2_change_stance(uuid,text,text,uuid)','public.combat2_character_stances(uuid)',
    'public.combat2_test_stop(uuid,uuid)','public.combat2_test_reset(uuid,uuid,boolean)'] LOOP
    IF NOT has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE')
      OR NOT has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE')
      OR has_function_privilege('anon',to_regprocedure(signature),'EXECUTE') THEN
      RAISE EXCEPTION 'ENG-STANCE ACL canonical access drift: %',signature;
    END IF;
  END LOOP;
END $$;
